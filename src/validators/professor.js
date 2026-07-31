/**
 * Validacao dos dados de professor (formularios do painel).
 *
 * Convencoes iguais as dos demais validadores: campo vazio vira `null` nos
 * opcionais e `undefined` nos obrigatorios, checkbox ausente vira `false` e as
 * chaves do schema sao os proprios atributos `name` do formulario.
 *
 * O e-mail e opcional, mas quando informado precisa ser valido e e normalizado
 * para minusculas (o indice unico do banco compara `LOWER(email)`).
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

const MENSAGEM_PADRAO = 'Verifique os campos destacados.';

const paraNulo = (valor) => {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    return valor;
};

const paraIndefinido = (valor) => {
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor === 'string' && valor.trim() === '') return undefined;
    return valor;
};

const paraBooleano = (valor) => {
    if (typeof valor === 'boolean') return valor;
    if (valor === undefined || valor === null || valor === '') return false;
    const bruto = Array.isArray(valor) ? valor[valor.length - 1] : valor;
    return ['1', 'true', 'on', 'sim'].includes(String(bruto).trim().toLowerCase());
};

const paraBooleanoOpcional = (valor) => {
    if (typeof valor === 'boolean') return valor;
    if (valor === undefined || valor === null || valor === '') return null;
    const texto = String(valor).trim().toLowerCase();
    if (['1', 'true', 'sim', 'ativo', 'ativos'].includes(texto)) return true;
    if (['0', 'false', 'nao', 'não', 'inativo', 'inativos'].includes(texto)) return false;
    return null;
};

/** Dados completos do professor (criacao e edicao). */
const schemaProfessor = z.object({
    nome: z.preprocess(
        paraIndefinido,
        z
            .string({ error: 'Informe o nome do professor.' })
            .trim()
            .min(1, { error: 'Informe o nome do professor.' })
            .max(150, { error: 'O nome deve ter no máximo 150 caracteres.' })
    ),
    email: z.preprocess(
        paraNulo,
        z
            .string({ error: 'Informe um e-mail válido.' })
            .trim()
            .toLowerCase()
            .max(150, { error: 'O e-mail deve ter no máximo 150 caracteres.' })
            .pipe(z.email({ error: 'Informe um e-mail válido.' }))
            .nullable()
    ),
    ativo: z.preprocess(paraBooleano, z.boolean()),
});

/** Filtros da listagem. Todos opcionais. */
const schemaFiltros = z.object({
    busca: z.preprocess(
        paraNulo,
        z
            .string({ error: 'Busca inválida.' })
            .trim()
            .max(120, { error: 'Busca muito longa.' })
            .nullable()
    ),
    status: z.preprocess(paraBooleanoOpcional, z.boolean().nullable()),
});

const mapearCampos = (erro) => {
    const campos = {};
    erro.issues.forEach((problema) => {
        const campo = problema.path.length > 0 ? String(problema.path[0]) : 'geral';
        if (!campos[campo]) campos[campo] = problema.message;
    });
    return campos;
};

const validar = (schema, dados = {}, mensagem = MENSAGEM_PADRAO) => {
    const resultado = schema.safeParse(dados || {});
    if (!resultado.success) {
        throw new ErroValidacao(mensagem, mapearCampos(resultado.error));
    }
    return resultado.data;
};

/**
 * Le do corpo da requisicao apenas os campos gravaveis do professor.
 * @param {Record<string, unknown>} corpo
 * @returns {{nome:string, email:string|null, ativo:boolean}}
 * @throws {ErroValidacao}
 */
const validarProfessor = (corpo = {}) =>
    validar(schemaProfessor, {
        nome: corpo.nome,
        email: corpo.email,
        ativo: corpo.ativo,
    });

/**
 * Le os filtros da listagem a partir da query string.
 * @param {Record<string, unknown>} query
 * @returns {{busca:string|null, status:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(schemaFiltros, {
        busca: query.busca,
        status: query.status,
    });

module.exports = {
    schemaProfessor,
    schemaFiltros,
    validar,
    validarProfessor,
    validarFiltros,
    mapearCampos,
};
