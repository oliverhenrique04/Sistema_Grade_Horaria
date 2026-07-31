/**
 * Validacao dos dados de turno.
 *
 * O `slug` e gerado a partir do nome quando o formulario o deixa em branco; se
 * informado, precisa respeitar `[a-z0-9-]` (e usado em URLs e no seed).
 *
 * As chaves do schema sao exatamente as colunas da tabela `turnos` (protecao
 * contra mass assignment: nada fora daqui e persistido).
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

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

const VERDADEIROS = ['1', 'true', 'on', 'sim', 'ativo', 'ativos'];
const FALSOS = ['0', 'false', 'off', 'nao', 'não', 'inativo', 'inativos'];

const ativoFormulario = z.preprocess((valor) => {
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor === undefined || valor === null ? '' : valor)
        .trim()
        .toLowerCase();
    if (FALSOS.includes(texto)) return false;
    return true;
}, z.boolean());

const ativoFiltro = z.preprocess((valor) => {
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor === undefined || valor === null ? '' : valor)
        .trim()
        .toLowerCase();
    if (VERDADEIROS.includes(texto)) return true;
    if (FALSOS.includes(texto)) return false;
    return null;
}, z.boolean().nullable());

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Gera um slug a partir de um texto livre: minusculas, sem acentos, separado
 * por hifens. Devolve string vazia quando nao sobra nenhum caractere valido.
 * @param {string} texto
 * @returns {string}
 */
const gerarSlug = (texto) =>
    String(texto || '')
        .normalize('NFD')
        // Remove os diacriticos separados pela normalizacao (a + acento -> a).
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');

/** Dados gravaveis de um turno. */
const schemaTurno = z
    .object({
        nome: z.preprocess(
            paraIndefinido,
            z
                .string({ error: 'Informe o nome do turno.' })
                .trim()
                .min(1, { error: 'Informe o nome do turno.' })
                .max(60, { error: 'O nome deve ter no máximo 60 caracteres.' })
        ),
        slug: z.preprocess(
            paraNulo,
            z
                .string({ error: 'Identificador inválido.' })
                .trim()
                .toLowerCase()
                .max(60, { error: 'O identificador deve ter no máximo 60 caracteres.' })
                .regex(SLUG_REGEX, {
                    error: 'Use apenas letras minúsculas, números e hífens (ex.: matutino).',
                })
                .nullable()
        ),
        icone: z
            .preprocess(
                paraNulo,
                z
                    .string({ error: 'Ícone inválido.' })
                    .trim()
                    .max(50, { error: 'O ícone deve ter no máximo 50 caracteres.' })
                    .regex(/^[a-z0-9 -]+$/i, {
                        error: 'Informe uma classe FontAwesome válida (ex.: fa-sun).',
                    })
                    .nullable()
            )
            .transform((valor) => valor || 'fa-clock'),
        tema_class: z.preprocess(
            paraNulo,
            z
                .string({ error: 'Classe de tema inválida.' })
                .trim()
                .max(50, { error: 'A classe de tema deve ter no máximo 50 caracteres.' })
                .regex(/^[a-z0-9 _-]+$/i, {
                    error: 'Use apenas letras, números, hífens e sublinhados.',
                })
                .nullable()
        ),
        ordem: z
            .preprocess(
                paraNulo,
                z.coerce
                    .number({ error: 'A ordem deve ser um número inteiro.' })
                    .int({ error: 'A ordem deve ser um número inteiro.' })
                    .min(0, { error: 'A ordem não pode ser negativa.' })
                    .max(999, { error: 'A ordem deve ser no máximo 999.' })
                    .nullable()
            )
            .transform((valor) => (valor === null ? 99 : valor)),
        ativo: ativoFormulario,
    })
    .transform((dados) => ({
        ...dados,
        // Slug em branco e derivado do nome; se o nome nao produzir nada
        // aproveitavel, o servico devolve erro de campo.
        slug: dados.slug || gerarSlug(dados.nome),
    }));

/**
 * Filtros da listagem. Valores invalidos viram "sem filtro" em vez de erro.
 */
const schemaFiltros = z.object({
    busca: z.preprocess(paraNulo, z.string().trim().max(120).nullable().catch(null)),
    ativo: ativoFiltro,
});

const mapearCampos = (erro) => {
    const campos = {};
    erro.issues.forEach((problema) => {
        const campo = problema.path.length > 0 ? String(problema.path[0]) : 'geral';
        if (!campos[campo]) campos[campo] = problema.message;
    });
    return campos;
};

const validar = (schema, dados = {}, mensagem = 'Verifique os campos destacados.') => {
    const resultado = schema.safeParse(dados || {});
    if (!resultado.success) {
        throw new ErroValidacao(mensagem, mapearCampos(resultado.error));
    }
    return resultado.data;
};

/**
 * Valida o corpo do formulario de turno.
 * @param {Record<string, unknown>} corpo
 * @returns {{nome:string, slug:string, icone:string, tema_class:string|null,
 *            ordem:number, ativo:boolean}}
 */
const validarTurno = (corpo = {}) =>
    validar(schemaTurno, {
        nome: corpo.nome,
        slug: corpo.slug,
        icone: corpo.icone,
        tema_class: corpo.tema_class,
        ordem: corpo.ordem,
        ativo: corpo.ativo,
    });

/**
 * Valida os filtros da listagem.
 * @param {Record<string, unknown>} query
 * @returns {{busca:string|null, ativo:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(schemaFiltros, { busca: query.busca, ativo: query.ativo }, 'Filtros inválidos.');

module.exports = {
    schemaTurno,
    schemaFiltros,
    validar,
    validarTurno,
    validarFiltros,
    gerarSlug,
};
