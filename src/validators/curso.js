/**
 * Validacao dos dados de curso (formularios do painel).
 *
 * Os formularios HTML enviam tudo como texto e os checkboxes simplesmente
 * desaparecem quando desmarcados, por isso os schemas normalizam antes de
 * validar:
 *  - campo vazio vira `null` nos opcionais e `undefined` nos obrigatorios
 *    (para que a mensagem exibida seja "informe ..." e nao um erro de tipo);
 *  - checkbox ausente vira `false`;
 *  - um unico checkbox marcado chega como string e e promovido a lista.
 *
 * Os schemas listam campo a campo o que pode ser gravado: nenhum outro dado do
 * `req.body` sobrevive a validacao (protecao contra mass assignment).
 *
 * As chaves dos schemas sao iguais aos atributos `name` dos formularios, de modo
 * que o mapa de erros devolvido possa ser usado direto pelo partial
 * `partials/campo-erro`.
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

const MENSAGEM_PADRAO = 'Verifique os campos destacados.';

/** Converte valores "vazios" de formulario em `null`. */
const paraNulo = (valor) => {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    return valor;
};

/** Converte valores "vazios" em `undefined` (dispara a mensagem de obrigatorio). */
const paraIndefinido = (valor) => {
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor === 'string' && valor.trim() === '') return undefined;
    return valor;
};

/** Checkbox de formulario: ausente significa `false`. */
const paraBooleano = (valor) => {
    if (typeof valor === 'boolean') return valor;
    if (valor === undefined || valor === null || valor === '') return false;
    const bruto = Array.isArray(valor) ? valor[valor.length - 1] : valor;
    return ['1', 'true', 'on', 'sim'].includes(String(bruto).trim().toLowerCase());
};

/** Filtro de status opcional: 'ativos' / 'inativos' / vazio. */
const paraBooleanoOpcional = (valor) => {
    if (typeof valor === 'boolean') return valor;
    if (valor === undefined || valor === null || valor === '') return null;
    const texto = String(valor).trim().toLowerCase();
    if (['1', 'true', 'sim', 'ativo', 'ativos'].includes(texto)) return true;
    if (['0', 'false', 'nao', 'não', 'inativo', 'inativos'].includes(texto)) return false;
    return null;
};

/** Um checkbox marcado chega como string; varios, como array. */
const paraLista = (valor) => {
    if (valor === undefined || valor === null || valor === '') return [];
    const lista = Array.isArray(valor) ? valor : [valor];
    return lista.filter((item) => item !== undefined && item !== null && item !== '');
};

/** Remove ids repetidos preservando a ordem. */
const semRepetidos = (lista) => [...new Set(lista)];

const nome = z.preprocess(
    paraIndefinido,
    z
        .string({ error: 'Informe o nome do curso.' })
        .trim()
        .min(1, { error: 'Informe o nome do curso.' })
        .max(120, { error: 'O nome deve ter no máximo 120 caracteres.' })
);

const sigla = z.preprocess(
    paraNulo,
    z
        .string({ error: 'Sigla inválida.' })
        .trim()
        .max(20, { error: 'A sigla deve ter no máximo 20 caracteres.' })
        .nullable()
);

const coordenador = z.preprocess(
    paraNulo,
    z
        .string({ error: 'Coordenador inválido.' })
        .trim()
        .max(120, { error: 'O nome do coordenador deve ter no máximo 120 caracteres.' })
        .nullable()
);

const MENSAGEM_SEMESTRES = 'A quantidade de semestres deve ser um número inteiro entre 1 e 20.';

const semestresTotal = z.preprocess(
    // Campo vazio assume o padrao do banco (8 semestres).
    (valor) => (paraNulo(valor) === null ? 8 : valor),
    z.coerce
        .number({ error: MENSAGEM_SEMESTRES })
        .int({ error: MENSAGEM_SEMESTRES })
        .min(1, { error: MENSAGEM_SEMESTRES })
        .max(20, { error: MENSAGEM_SEMESTRES })
);

const campusIds = z.preprocess(
    paraLista,
    z
        .array(
            z.coerce
                .number({ error: 'Selecione apenas campus válidos.' })
                .int({ error: 'Selecione apenas campus válidos.' })
                .positive({ error: 'Selecione apenas campus válidos.' })
        )
        .transform(semRepetidos)
);

/** Dados completos do curso (criacao e edicao). */
const schemaCurso = z.object({
    nome,
    sigla,
    coordenador,
    semestresTotal,
    ativo: z.preprocess(paraBooleano, z.boolean()),
    campusIds,
});

/** Id vindo de filtro: valor invalido e simplesmente ignorado (vira `null`). */
const idFiltro = z.preprocess((valor) => {
    const numero = Number.parseInt(String(paraNulo(valor) ?? ''), 10);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
}, z.number().int().positive().nullable());

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
    campusId: idFiltro,
    status: z.preprocess(paraBooleanoOpcional, z.boolean().nullable()),
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
const validar = (schema, dados = {}, mensagem = MENSAGEM_PADRAO) => {
    const resultado = schema.safeParse(dados || {});
    if (!resultado.success) {
        throw new ErroValidacao(mensagem, mapearCampos(resultado.error));
    }
    return resultado.data;
};

/**
 * Le do corpo da requisicao apenas os campos gravaveis do curso.
 * @param {Record<string, unknown>} corpo
 * @returns {{nome:string, sigla:string|null, coordenador:string|null,
 *            semestresTotal:number, ativo:boolean, campusIds:number[]}}
 * @throws {ErroValidacao}
 */
const validarCurso = (corpo = {}) =>
    validar(schemaCurso, {
        nome: corpo.nome,
        sigla: corpo.sigla,
        coordenador: corpo.coordenador,
        semestresTotal: corpo.semestresTotal,
        ativo: corpo.ativo,
        campusIds: corpo.campusIds,
    });

/**
 * Le os filtros da listagem a partir da query string.
 * @param {Record<string, unknown>} query
 * @returns {{busca:string|null, campusId:number|null, status:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(schemaFiltros, {
        busca: query.busca,
        campusId: query.campusId,
        status: query.status,
    });

module.exports = {
    schemaCurso,
    schemaFiltros,
    validar,
    validarCurso,
    validarFiltros,
    mapearCampos,
    paraLista,
    paraBooleano,
};
