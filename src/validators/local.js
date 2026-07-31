/**
 * Validacao dos dados de local (sala, laboratorio, auditorio...).
 *
 * O tipo vem da lista unica de `src/utils/formatadores.js`, que espelha o CHECK
 * `ck_local_tipo` do banco. As chaves do schema sao exatamente as colunas da
 * tabela `locais` (protecao contra mass assignment).
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');
const { TIPOS_LOCAL } = require('../utils/formatadores');

const VALORES_TIPO = TIPOS_LOCAL.map((item) => item.valor);

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

/** Dados gravaveis de um local. */
const schemaLocal = z.object({
    campus_id: z.preprocess(
        paraIndefinido,
        z.coerce
            .number({ error: 'Selecione o campus.' })
            .int({ error: 'Selecione o campus.' })
            .positive({ error: 'Selecione o campus.' })
    ),
    nome: z.preprocess(
        paraIndefinido,
        z
            .string({ error: 'Informe o nome do local.' })
            .trim()
            .min(1, { error: 'Informe o nome do local.' })
            .max(120, { error: 'O nome deve ter no máximo 120 caracteres.' })
    ),
    codigo: z.preprocess(
        paraNulo,
        z
            .string({ error: 'Código inválido.' })
            .trim()
            .max(40, { error: 'O código deve ter no máximo 40 caracteres.' })
            .nullable()
    ),
    tipo: z
        .preprocess(
            paraNulo,
            z.enum(VALORES_TIPO, { error: 'Selecione um tipo de local válido.' }).nullable()
        )
        .transform((valor) => valor || 'sala'),
    capacidade: z.preprocess(
        paraNulo,
        z.coerce
            .number({ error: 'A capacidade deve ser um número inteiro.' })
            .int({ error: 'A capacidade deve ser um número inteiro.' })
            .min(0, { error: 'A capacidade não pode ser negativa.' })
            .max(100000, { error: 'Capacidade acima do limite permitido.' })
            .nullable()
    ),
    ativo: ativoFormulario,
});

/**
 * Filtros da listagem. Valores invalidos viram "sem filtro" em vez de erro.
 */
const schemaFiltros = z.object({
    campus_id: z.preprocess(paraNulo, z.coerce.number().int().positive().nullable().catch(null)),
    tipo: z.preprocess(paraNulo, z.enum(VALORES_TIPO).nullable().catch(null)),
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
 * Valida o corpo do formulario de local.
 * @param {Record<string, unknown>} corpo
 * @returns {{campus_id:number, nome:string, codigo:string|null, tipo:string,
 *            capacidade:number|null, ativo:boolean}}
 */
const validarLocal = (corpo = {}) =>
    validar(schemaLocal, {
        campus_id: corpo.campus_id,
        nome: corpo.nome,
        codigo: corpo.codigo,
        tipo: corpo.tipo,
        capacidade: corpo.capacidade,
        ativo: corpo.ativo,
    });

/**
 * Valida os filtros da listagem.
 * @param {Record<string, unknown>} query
 * @returns {{campus_id:number|null, tipo:string|null, busca:string|null, ativo:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(
        schemaFiltros,
        {
            campus_id: query.campus_id,
            tipo: query.tipo,
            busca: query.busca,
            ativo: query.ativo,
        },
        'Filtros inválidos.'
    );

module.exports = {
    schemaLocal,
    schemaFiltros,
    validar,
    validarLocal,
    validarFiltros,
    VALORES_TIPO,
};
