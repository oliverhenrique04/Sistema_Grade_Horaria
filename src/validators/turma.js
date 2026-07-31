/**
 * Validacao dos dados de turma (formularios HTML e filtros de listagem).
 *
 * Os formularios enviam tudo como string ("", "12", "true"), por isso os
 * schemas normalizam antes de validar:
 *  - string vazia / null / undefined viram `null` nos campos opcionais;
 *  - string vazia vira `undefined` nos campos obrigatorios, para que a mensagem
 *    exibida seja "selecione ..." e nao um erro de tipo;
 *  - ids e semestre curricular sao convertidos para inteiro com `z.coerce`.
 *
 * O schema lista campo a campo o que pode ser gravado. Nenhum outro campo do
 * `req.body` sobrevive a validacao (protecao contra mass assignment): o objeto
 * devolvido contem exclusivamente as chaves declaradas aqui.
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

/** Faixa aceita pelo banco (CHECK ck_turma_semestre). */
const SEMESTRE_MINIMO = 1;
const SEMESTRE_MAXIMO = 20;

/** Opcoes de semestre oferecidas nos selects. */
const SEMESTRES = Array.from(
    { length: SEMESTRE_MAXIMO - SEMESTRE_MINIMO + 1 },
    (_valor, indice) => SEMESTRE_MINIMO + indice
);

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

/** Id obrigatorio: inteiro positivo. */
const idObrigatorio = (mensagem) =>
    z.preprocess(
        paraIndefinido,
        z.coerce.number({ error: mensagem }).int({ error: mensagem }).positive({ error: mensagem })
    );

/** Id opcional (filtros): inteiro positivo ou `null`. Valor invalido vira `null`. */
const idFiltro = () =>
    z.preprocess(paraNulo, z.coerce.number().int().positive().nullable()).catch(null);

/** Interpreta "true"/"1"/"ativo" e "false"/"0"/"inativo" vindos de selects. */
const interpretarBooleano = (valor, padrao) => {
    if (valor === undefined || valor === null || valor === '') return padrao;
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor).trim().toLowerCase();
    if (['1', 'true', 'sim', 'ativo', 'ativa', 'ativos', 'ativas'].includes(texto)) return true;
    if (
        ['0', 'false', 'nao', 'não', 'inativo', 'inativa', 'inativos', 'inativas'].includes(texto)
    ) {
        return false;
    }
    return padrao;
};

const schemaTurma = z.object({
    nome: z.preprocess(
        paraIndefinido,
        z
            .string({ error: 'Informe o nome da turma.' })
            .trim()
            .min(1, { error: 'Informe o nome da turma.' })
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
    periodoLetivoId: idObrigatorio('Selecione o período letivo.'),
    campusId: idObrigatorio('Selecione o campus.'),
    cursoId: idObrigatorio('Selecione o curso.'),
    // Opcional: alem das turmas gerenciais, a instituicao oferta turmas
    // especiais que atravessam semestres (DIRESPM1). Vazio significa
    // "nao se aplica", nao "esqueci de preencher".
    semestreCurricular: z.preprocess(
        paraNulo,
        z.coerce
            .number({ error: 'O semestre curricular deve ser um número inteiro.' })
            .int({ error: 'O semestre curricular deve ser um número inteiro.' })
            .min(SEMESTRE_MINIMO, {
                error: `O semestre curricular deve estar entre ${SEMESTRE_MINIMO} e ${SEMESTRE_MAXIMO}.`,
            })
            .max(SEMESTRE_MAXIMO, {
                error: `O semestre curricular deve estar entre ${SEMESTRE_MINIMO} e ${SEMESTRE_MAXIMO}.`,
            })
            .nullable()
    ),
    turnoId: idObrigatorio('Selecione o turno.'),
    gerencial: z.preprocess((valor) => interpretarBooleano(valor, false), z.boolean()),
    ativo: z.preprocess((valor) => interpretarBooleano(valor, true), z.boolean()),
});

/** Alteracao isolada de situacao (botao ativar/inativar da listagem). */
const schemaStatus = z.object({
    ativo: z.preprocess(
        (valor) => interpretarBooleano(valor, null),
        z.boolean({ error: 'Informe a nova situação da turma.' })
    ),
});

/**
 * Filtros da listagem. Todos opcionais e tolerantes: um parametro invalido na
 * query string e ignorado (vira `null`) em vez de quebrar a pagina.
 */
const schemaFiltros = z.object({
    /**
     * `grade` (padrao) lista apenas as turmas em que se monta grade: as
     * gerenciais e as que nao recebem disciplina de nenhuma. `todas` mostra
     * tambem as que sao atendidas por uma gerencial.
     */
    exibicao: z
        .preprocess((valor) => (valor === 'todas' ? 'todas' : 'grade'), z.enum(['grade', 'todas']))
        .catch('grade'),
    busca: z.preprocess(paraNulo, z.string().trim().max(120).nullable()).catch(null),
    periodoLetivoId: idFiltro(),
    campusId: idFiltro(),
    cursoId: idFiltro(),
    turnoId: idFiltro(),
    semestreCurricular: z
        .preprocess(
            paraNulo,
            z.coerce.number().int().min(SEMESTRE_MINIMO).max(SEMESTRE_MAXIMO).nullable()
        )
        .catch(null),
    ativo: z
        .preprocess((valor) => interpretarBooleano(valor, null), z.boolean().nullable())
        .catch(null),
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
 * @param {string} [mensagem] resumo exibido quando ha erros
 * @returns {T} dados normalizados (somente os campos do schema)
 * @throws {ErroValidacao} com `campos` = { campo: 'mensagem em portugues' }
 */
const validar = (schema, dados = {}, mensagem = 'Verifique os campos destacados.') => {
    const resultado = schema.safeParse(dados || {});
    if (!resultado.success) {
        throw new ErroValidacao(mensagem, mapearCampos(resultado.error));
    }
    return resultado.data;
};

module.exports = {
    schemaTurma,
    schemaStatus,
    schemaFiltros,
    validar,
    SEMESTRES,
    SEMESTRE_MINIMO,
    SEMESTRE_MAXIMO,
};
