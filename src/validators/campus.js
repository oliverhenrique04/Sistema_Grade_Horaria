/**
 * Validacao dos dados de campus (formularios HTML do painel).
 *
 * Os formularios enviam tudo como texto (""/"1"/"Asa Sul"), por isso cada campo
 * e normalizado antes de validar: vazio vira `undefined` nos obrigatorios (para
 * a mensagem ser "informe ..." e nao um erro de tipo) e `null` nos opcionais.
 *
 * As chaves do schema sao exatamente as colunas da tabela `campus`. Nenhum outro
 * campo do `req.body` sobrevive a validacao (protecao contra mass assignment).
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

/** Converte valores "vazios" de formulario em `null`. */
const paraNulo = (valor) => {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    return valor;
};

/** Converte valores "vazios" de formulario em `undefined` (dispara "obrigatorio"). */
const paraIndefinido = (valor) => {
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor === 'string' && valor.trim() === '') return undefined;
    return valor;
};

const VERDADEIROS = ['1', 'true', 'on', 'sim', 'ativo', 'ativos'];
const FALSOS = ['0', 'false', 'off', 'nao', 'não', 'inativo', 'inativos'];

/** Situacao enviada pelo formulario. Campo ausente significa "ativo". */
const ativoFormulario = z.preprocess((valor) => {
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor === undefined || valor === null ? '' : valor)
        .trim()
        .toLowerCase();
    if (FALSOS.includes(texto)) return false;
    return true;
}, z.boolean());

/** Situacao usada como filtro: vazio significa "todos". */
const ativoFiltro = z.preprocess((valor) => {
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor === undefined || valor === null ? '' : valor)
        .trim()
        .toLowerCase();
    if (VERDADEIROS.includes(texto)) return true;
    if (FALSOS.includes(texto)) return false;
    return null;
}, z.boolean().nullable());

/** Dados gravaveis de um campus (criacao e edicao). */
const schemaCampus = z.object({
    nome: z.preprocess(
        paraIndefinido,
        z
            .string({ error: 'Informe o nome do campus.' })
            .trim()
            .min(1, { error: 'Informe o nome do campus.' })
            .max(120, { error: 'O nome deve ter no máximo 120 caracteres.' })
    ),
    sigla: z.preprocess(
        paraNulo,
        z
            .string({ error: 'Sigla inválida.' })
            .trim()
            .max(20, { error: 'A sigla deve ter no máximo 20 caracteres.' })
            .nullable()
    ),
    ativo: ativoFormulario,
});

/**
 * Filtros da listagem. Todos opcionais e tolerantes: um valor invalido na query
 * string vira "sem filtro" (`.catch(null)`) em vez de derrubar a pagina.
 */
const schemaFiltros = z.object({
    busca: z.preprocess(paraNulo, z.string().trim().max(120).nullable().catch(null)),
    ativo: ativoFiltro,
});

/**
 * Converte os issues do zod em um mapa campo -> mensagem (primeira ocorrencia).
 * @param {import('zod').ZodError} erro
 * @returns {Record<string, string>}
 */
const mapearCampos = (erro) => {
    const campos = {};
    erro.issues.forEach((problema) => {
        const campo = problema.path.length > 0 ? String(problema.path[0]) : 'geral';
        if (!campos[campo]) campos[campo] = problema.message;
    });
    return campos;
};

/**
 * Valida `dados` contra `schema`.
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {Record<string, unknown>} dados
 * @param {string} [mensagem]
 * @returns {T}
 * @throws {ErroValidacao}
 */
const validar = (schema, dados = {}, mensagem = 'Verifique os campos destacados.') => {
    const resultado = schema.safeParse(dados || {});
    if (!resultado.success) {
        throw new ErroValidacao(mensagem, mapearCampos(resultado.error));
    }
    return resultado.data;
};

/**
 * Valida o corpo do formulario de campus.
 * @param {Record<string, unknown>} corpo
 * @returns {{nome:string, sigla:string|null, ativo:boolean}}
 */
const validarCampus = (corpo = {}) =>
    validar(schemaCampus, {
        nome: corpo.nome,
        sigla: corpo.sigla,
        ativo: corpo.ativo,
    });

/**
 * Valida os filtros da listagem.
 * @param {Record<string, unknown>} query
 * @returns {{busca:string|null, ativo:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(schemaFiltros, { busca: query.busca, ativo: query.ativo }, 'Filtros inválidos.');

module.exports = { schemaCampus, schemaFiltros, validar, validarCampus, validarFiltros };
