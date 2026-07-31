/**
 * Validacao dos dados de disciplina (formularios do painel).
 *
 * Convencoes iguais as dos demais validadores: campo vazio vira `null` nos
 * opcionais e `undefined` nos obrigatorios, checkbox ausente vira `false` e as
 * chaves do schema sao os proprios atributos `name` do formulario.
 *
 * Vinculo com cursos: o formulario envia um checkbox `cursosIds` por curso
 * marcado e, para cada um, um campo `semestre_<cursoId>` com o semestre
 * sugerido. `montarVinculos` recompoe os pares a partir dos ids marcados —
 * campos de semestre de cursos nao marcados sao ignorados.
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

const MENSAGEM_PADRAO = 'Verifique os campos destacados.';
const MENSAGEM_SEMESTRE = 'Informe um semestre entre 1 e 20 para cada curso selecionado.';
const MENSAGEM_CARGA = 'A carga horária deve ser um número inteiro maior que zero.';

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

const paraLista = (valor) => {
    if (valor === undefined || valor === null || valor === '') return [];
    const lista = Array.isArray(valor) ? valor : [valor];
    return lista.filter((item) => item !== undefined && item !== null && item !== '');
};

const schemaVinculo = z.object({
    cursoId: z.coerce
        .number({ error: 'Selecione apenas cursos válidos.' })
        .int({ error: 'Selecione apenas cursos válidos.' })
        .positive({ error: 'Selecione apenas cursos válidos.' }),
    semestreSugerido: z.preprocess(
        paraNulo,
        z.coerce
            .number({ error: MENSAGEM_SEMESTRE })
            .int({ error: MENSAGEM_SEMESTRE })
            .min(1, { error: MENSAGEM_SEMESTRE })
            .max(20, { error: MENSAGEM_SEMESTRE })
            .nullable()
    ),
});

/** Dados completos da disciplina (criacao e edicao). */
const schemaDisciplina = z.object({
    nome: z.preprocess(
        paraIndefinido,
        z
            .string({ error: 'Informe o nome da disciplina.' })
            .trim()
            .min(1, { error: 'Informe o nome da disciplina.' })
            .max(150, { error: 'O nome deve ter no máximo 150 caracteres.' })
    ),
    codigo: z.preprocess(
        paraNulo,
        z
            .string({ error: 'Código inválido.' })
            .trim()
            .max(30, { error: 'O código deve ter no máximo 30 caracteres.' })
            .nullable()
    ),
    cargaHoraria: z.preprocess(
        paraNulo,
        z.coerce
            .number({ error: MENSAGEM_CARGA })
            .int({ error: MENSAGEM_CARGA })
            .positive({ error: MENSAGEM_CARGA })
            .max(10000, { error: 'A carga horária deve ser menor que 10000 horas.' })
            .nullable()
    ),
    ativo: z.preprocess(paraBooleano, z.boolean()),
    vinculos: z.array(schemaVinculo),
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
    cursoId: idFiltro,
    status: z.preprocess(paraBooleanoOpcional, z.boolean().nullable()),
});

/**
 * Recompoe os vinculos curso/semestre a partir do corpo do formulario.
 *
 * Le apenas as chaves `semestre_<id>` dos cursos efetivamente marcados: nenhum
 * outro campo do corpo e considerado.
 *
 * @param {Record<string, unknown>} corpo
 * @returns {{cursoId:unknown, semestreSugerido:unknown}[]}
 */
const montarVinculos = (corpo = {}) => {
    const ids = paraLista(corpo.cursosIds);
    const vistos = new Set();
    const vinculos = [];

    ids.forEach((bruto) => {
        const chave = String(bruto).trim();
        if (!chave || vistos.has(chave)) return;
        vistos.add(chave);
        vinculos.push({
            cursoId: chave,
            semestreSugerido: corpo[`semestre_${chave}`],
        });
    });

    return vinculos;
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
 * Le do corpo da requisicao apenas os campos gravaveis da disciplina.
 * @param {Record<string, unknown>} corpo
 * @returns {{nome:string, codigo:string|null, cargaHoraria:number|null, ativo:boolean,
 *            vinculos:{cursoId:number, semestreSugerido:number|null}[]}}
 * @throws {ErroValidacao}
 */
const validarDisciplina = (corpo = {}) =>
    validar(schemaDisciplina, {
        nome: corpo.nome,
        codigo: corpo.codigo,
        cargaHoraria: corpo.cargaHoraria,
        ativo: corpo.ativo,
        vinculos: montarVinculos(corpo),
    });

/**
 * Le os filtros da listagem a partir da query string.
 * @param {Record<string, unknown>} query
 * @returns {{busca:string|null, cursoId:number|null, status:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(schemaFiltros, {
        busca: query.busca,
        cursoId: query.cursoId,
        status: query.status,
    });

module.exports = {
    schemaDisciplina,
    schemaFiltros,
    validar,
    validarDisciplina,
    validarFiltros,
    montarVinculos,
    mapearCampos,
};
