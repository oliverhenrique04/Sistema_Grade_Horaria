/**
 * Validacao dos dados de periodo letivo (formularios do painel).
 *
 * Convencoes iguais as dos demais validadores: campo vazio vira `null` nos
 * opcionais e `undefined` nos obrigatorios, checkbox ausente vira `false` e as
 * chaves do schema sao os proprios atributos `name` do formulario.
 *
 * Conveniencia especifica deste recurso: quando o codigo segue o padrao
 * "2026.1" e o usuario deixa ano/semestre em branco, os dois sao deduzidos no
 * servidor (ver `completarDoCodigo`).
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

const MENSAGEM_PADRAO = 'Verifique os campos destacados.';

/** Codigos no formato "<ano>.<semestre>", ex.: 2026.1 */
const PADRAO_CODIGO = /^(\d{4})\.(\d)$/;

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

const MENSAGEM_ANO = 'O ano deve ser um número inteiro entre 2000 e 2100.';
const MENSAGEM_SEMESTRE = 'O semestre deve ser um número inteiro entre 1 e 4.';
const MENSAGEM_DATA = 'Informe uma data válida (formato dia/mês/ano).';

/** Aceita apenas datas reais no formato ISO enviado por `<input type="date">`. */
const dataOpcional = z.preprocess(
    paraNulo,
    z
        .string({ error: MENSAGEM_DATA })
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, { error: MENSAGEM_DATA })
        .refine(
            (texto) => {
                const [ano, mes, dia] = texto.split('-').map(Number);
                const data = new Date(Date.UTC(ano, mes - 1, dia));
                return (
                    data.getUTCFullYear() === ano &&
                    data.getUTCMonth() === mes - 1 &&
                    data.getUTCDate() === dia
                );
            },
            { error: MENSAGEM_DATA }
        )
        .nullable()
);

const schemaPeriodo = z
    .object({
        codigo: z.preprocess(
            paraIndefinido,
            z
                .string({ error: 'Informe o código do período (ex.: 2026.1).' })
                .trim()
                .min(1, { error: 'Informe o código do período (ex.: 2026.1).' })
                .max(20, { error: 'O código deve ter no máximo 20 caracteres.' })
        ),
        ano: z.preprocess(
            paraIndefinido,
            z.coerce
                .number({ error: MENSAGEM_ANO })
                .int({ error: MENSAGEM_ANO })
                .min(2000, { error: MENSAGEM_ANO })
                .max(2100, { error: MENSAGEM_ANO })
        ),
        semestre: z.preprocess(
            paraIndefinido,
            z.coerce
                .number({ error: MENSAGEM_SEMESTRE })
                .int({ error: MENSAGEM_SEMESTRE })
                .min(1, { error: MENSAGEM_SEMESTRE })
                .max(4, { error: MENSAGEM_SEMESTRE })
        ),
        dataInicio: dataOpcional,
        dataFim: dataOpcional,
        atual: z.preprocess(paraBooleano, z.boolean()),
        ativo: z.preprocess(paraBooleano, z.boolean()),
    })
    .refine((dados) => !dados.dataInicio || !dados.dataFim || dados.dataFim >= dados.dataInicio, {
        error: 'A data de término deve ser igual ou posterior à data de início.',
        path: ['dataFim'],
    });

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
    ano: idFiltro,
    status: z.preprocess(paraBooleanoOpcional, z.boolean().nullable()),
});

/**
 * Deduz ano e semestre a partir do codigo quando vierem em branco.
 * Nao sobrescreve nada que o usuario tenha digitado.
 * @param {Record<string, unknown>} dados
 * @returns {Record<string, unknown>} copia com ano/semestre possivelmente preenchidos
 */
const completarDoCodigo = (dados = {}) => {
    const codigo = typeof dados.codigo === 'string' ? dados.codigo.trim() : '';
    const casamento = PADRAO_CODIGO.exec(codigo);
    if (!casamento) return dados;

    return {
        codigo: dados.codigo,
        ano: paraNulo(dados.ano) === null ? casamento[1] : dados.ano,
        semestre: paraNulo(dados.semestre) === null ? casamento[2] : dados.semestre,
        dataInicio: dados.dataInicio,
        dataFim: dados.dataFim,
        atual: dados.atual,
        ativo: dados.ativo,
    };
};

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
 * Le do corpo da requisicao apenas os campos gravaveis do periodo letivo.
 * @param {Record<string, unknown>} corpo
 * @returns {{codigo:string, ano:number, semestre:number, dataInicio:string|null,
 *            dataFim:string|null, atual:boolean, ativo:boolean}}
 * @throws {ErroValidacao}
 */
const validarPeriodo = (corpo = {}) =>
    validar(
        schemaPeriodo,
        completarDoCodigo({
            codigo: corpo.codigo,
            ano: corpo.ano,
            semestre: corpo.semestre,
            dataInicio: corpo.dataInicio,
            dataFim: corpo.dataFim,
            atual: corpo.atual,
            ativo: corpo.ativo,
        })
    );

/**
 * Le os filtros da listagem a partir da query string.
 * @param {Record<string, unknown>} query
 * @returns {{busca:string|null, ano:number|null, status:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(schemaFiltros, {
        busca: query.busca,
        ano: query.ano,
        status: query.status,
    });

module.exports = {
    schemaPeriodo,
    schemaFiltros,
    validar,
    validarPeriodo,
    validarFiltros,
    completarDoCodigo,
    mapearCampos,
    PADRAO_CODIGO,
};
