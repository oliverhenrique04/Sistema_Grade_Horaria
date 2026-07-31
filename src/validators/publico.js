/**
 * Saneamento da query string da area publica de consulta.
 *
 * Regra geral: entrada invalida NUNCA vira erro. Cada parametro que nao passa
 * na validacao simplesmente desaparece (vira `undefined`), de modo que a pagina
 * responde 200 com o filtro correspondente vazio. Isso evita que um link
 * quebrado compartilhado entre alunos derrube a consulta com 500.
 */
const { z } = require('zod');

/** Maior valor aceito por uma coluna INT do PostgreSQL. */
const MAX_INT = 2147483647;

/** Limite de semestre curricular espelhado do CHECK de `turmas`. */
const SEMESTRE_MAXIMO = 20;

/** Tamanho maximo de um slug legado (`?unidade=aguas-claras`). */
const SLUG_MAXIMO = 80;

/**
 * Identificador numerico opcional. Aceita apenas digitos para nao depender de
 * coercao silenciosa ("12abc" seria 12 com `Number.parseInt`).
 */
const idOpcional = z
    .string()
    .trim()
    .regex(/^\d{1,10}$/)
    .transform((valor) => Number(valor))
    .refine((numero) => numero >= 1 && numero <= MAX_INT)
    .optional()
    .catch(undefined);

/** Semestre curricular opcional (1..20). */
const semestreOpcional = z
    .string()
    .trim()
    .regex(/^\d{1,2}$/)
    .transform((valor) => Number(valor))
    .refine((numero) => numero >= 1 && numero <= SEMESTRE_MAXIMO)
    .optional()
    .catch(undefined);

/** Slug legado: apenas letras minusculas, digitos e hifen. */
const slugOpcional = z
    .string()
    .trim()
    .toLowerCase()
    .regex(new RegExp(`^[a-z0-9-]{1,${SLUG_MAXIMO}}$`))
    .optional()
    .catch(undefined);

/**
 * Formato atual da consulta: ids numericos validados.
 * `.catch({})` cobre o caso extremo de `req.query` nao ser um objeto.
 */
const esquemaConsulta = z
    .object({
        periodo: idOpcional,
        campus: idOpcional,
        curso: idOpcional,
        semestre: semestreOpcional,
        turno: idOpcional,
        turma: idOpcional,
    })
    .catch({});

/** Formato legado: `?unidade=<slug>&curso=<slug>`. */
const esquemaLegado = z
    .object({
        unidade: slugOpcional,
        curso: slugOpcional,
    })
    .catch({});

/** Texto util (string nao vazia) recebido na query string. */
const textoDaQuery = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/** Um `curso` so digitos e o formato novo (id), nao um slug legado. */
const pareceId = (valor) => /^\d+$/.test(valor);

/**
 * Valida e normaliza os filtros no formato atual (ids numericos).
 * @param {Record<string, unknown>} [query]
 * @returns {{periodoId?:number, campusId?:number, cursoId?:number,
 *            semestre?:number, turnoId?:number, turmaId?:number}}
 */
const validarConsulta = (query = {}) => {
    const resultado = esquemaConsulta.safeParse(query || {});
    const dados = resultado.success ? resultado.data : {};

    return {
        periodoId: dados.periodo,
        campusId: dados.campus,
        cursoId: dados.curso,
        semestre: dados.semestre,
        turnoId: dados.turno,
        turmaId: dados.turma,
    };
};

/**
 * Indica se a requisicao usa os parametros da versao antiga da area publica
 * (`?unidade=aguas-claras&curso=direito`), que devem ser canonizados por
 * redirecionamento.
 * @param {Record<string, unknown>} [query]
 * @returns {boolean}
 */
const temParametrosLegados = (query = {}) => {
    const unidade = textoDaQuery(query.unidade);
    const curso = textoDaQuery(query.curso);

    if (unidade) return true;
    return Boolean(curso) && !pareceId(curso);
};

/**
 * Extrai os slugs legados reconhecidos. Valores fora do formato de slug sao
 * descartados (o redirecionamento apenas remove o parametro).
 * @param {Record<string, unknown>} [query]
 * @returns {{unidadeSlug?:string, cursoSlug?:string}}
 */
const validarLegado = (query = {}) => {
    const curso = textoDaQuery(query.curso);
    const bruto = { unidade: query.unidade };

    if (curso && !pareceId(curso)) bruto.curso = curso;

    const resultado = esquemaLegado.safeParse(bruto);
    const dados = resultado.success ? resultado.data : {};

    return { unidadeSlug: dados.unidade, cursoSlug: dados.curso };
};

module.exports = {
    esquemaConsulta,
    esquemaLegado,
    validarConsulta,
    validarLegado,
    temParametrosLegados,
};
