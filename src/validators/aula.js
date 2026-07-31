/**
 * Validacao dos dados de aula (formularios HTML e requisicoes JSON).
 *
 * Os formularios enviam tudo como string ("", "12", "presencial"), por isso os
 * schemas normalizam antes de validar:
 *  - string vazia / null / undefined viram `null` nos campos opcionais;
 *  - string vazia vira `undefined` nos campos obrigatorios, para que a mensagem
 *    exibida seja "selecione ..." e nao um erro de tipo;
 *  - ids e dia da semana sao convertidos para inteiro com `z.coerce`.
 *
 * Os schemas listam campo a campo o que pode ser gravado. Nenhum outro campo do
 * `req.body` sobrevive a validacao (protecao contra mass assignment).
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');
const { MODALIDADES } = require('../utils/formatadores');
const { PRIMEIRO_DIA, ULTIMO_DIA } = require('../utils/dias');

const VALORES_MODALIDADE = MODALIDADES.map((item) => item.valor);

/** Converte valores "vazios" de formulario em `null`. */
const paraNulo = (valor) => {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    return valor;
};

/** Converte valores "vazios" de formulario em `undefined` (dispara o erro de obrigatorio). */
const paraIndefinido = (valor) => {
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor === 'string' && valor.trim() === '') return undefined;
    return valor;
};

/**
 * Id obrigatorio: inteiro positivo.
 * @param {string} mensagem texto exibido quando ausente ou invalido
 */
const idObrigatorio = (mensagem) =>
    z.preprocess(
        paraIndefinido,
        z.coerce.number({ error: mensagem }).int({ error: mensagem }).positive({ error: mensagem })
    );

/**
 * Id opcional: inteiro positivo ou `null` quando o campo vem vazio.
 * @param {string} mensagem
 */
const idOpcional = (mensagem) =>
    z.preprocess(
        paraNulo,
        z.coerce
            .number({ error: mensagem })
            .int({ error: mensagem })
            .positive({ error: mensagem })
            .nullable()
    );

const diaSemana = z.preprocess(
    paraIndefinido,
    z.coerce
        .number({ error: 'Selecione o dia da semana.' })
        .int({ error: 'Selecione o dia da semana.' })
        .min(PRIMEIRO_DIA, { error: 'O dia da semana deve estar entre segunda-feira e sábado.' })
        .max(ULTIMO_DIA, { error: 'O dia da semana deve estar entre segunda-feira e sábado.' })
);

const modalidade = z
    .preprocess(
        paraNulo,
        z.enum(VALORES_MODALIDADE, { error: 'Selecione uma modalidade válida.' }).nullable()
    )
    .transform((valor) => valor || 'presencial');

const observacao = z.preprocess(
    paraNulo,
    z
        .string({ error: 'Observação inválida.' })
        .trim()
        .max(255, { error: 'A observação deve ter no máximo 255 caracteres.' })
        .nullable()
);

/**
 * Turmas que cursam a aula.
 *
 * So faz sentido em turma gerencial, onde uma mesma aula atende varias turmas
 * regulares — quase sempre de semestres diferentes. Formulario HTML envia um
 * valor por caixa marcada; nenhuma caixa marcada chega como campo ausente, e
 * `undefined` significa "nao mexer no vinculo atual".
 */
const turmasAtendidas = z.preprocess(
    (valor) => {
        if (valor === undefined) return undefined;
        const lista = Array.isArray(valor) ? valor : [valor];
        return [
            ...new Set(
                lista
                    .map((item) => Number.parseInt(item, 10))
                    .filter((item) => Number.isFinite(item) && item > 0)
            ),
        ];
    },
    z.array(z.number().int().positive()).max(200, { error: 'Turmas demais nesta aula.' }).optional()
);

/** Dados completos de uma aula (criacao e edicao). */
const schemaAula = z.object({
    turmaId: idObrigatorio('Selecione a turma.'),
    disciplinaId: idObrigatorio('Selecione a disciplina.'),
    professorId: idOpcional('Selecione um professor válido.'),
    localId: idOpcional('Selecione um local válido.'),
    diaSemana,
    horarioTurnoId: idOpcional('Selecione um horário válido.'),
    modalidade,
    observacao,
    turmasAtendidas,
});

/** Novo posicionamento de uma aula existente (arrastar/soltar na grade). */
const schemaMover = z.object({
    diaSemana,
    horarioTurnoId: idOpcional('Selecione um horário válido.'),
});

/**
 * Lista de inteiros positivos vinda de caixas de selecao.
 *
 * Formulario HTML envia um valor por caixa marcada, uma string solta quando so
 * uma esta marcada e nada quando nenhuma esta. Lista vazia sempre significa
 * "todos" — e o recorte de quem nao quer filtrar por este eixo.
 */
const listaDeSelecao = (limite, mensagem, minimo = 1, maximo = Number.MAX_SAFE_INTEGER) =>
    z.preprocess(
        (valor) => {
            if (valor === undefined || valor === null) return [];
            const lista = Array.isArray(valor) ? valor : [valor];
            return [
                ...new Set(
                    lista
                        .map((item) => Number.parseInt(item, 10))
                        .filter((item) => Number.isFinite(item) && item >= minimo && item <= maximo)
                ),
            ];
        },
        z.array(z.number().int()).max(limite, { error: mensagem })
    );

/**
 * Alocacao do mesmo local em varias aulas da turma.
 *
 * Tres eixos independentes de recorte — disciplina, dia da semana e horario —
 * mais o atalho "so as que estao sem local". `localId` nulo limpa a alocacao,
 * util para desfazer uma aplicacao errada sem abrir aula por aula.
 */
const schemaLocalEmLote = z.object({
    localId: idOpcional('Selecione um local válido.'),
    disciplinas: listaDeSelecao(300, 'Disciplinas demais selecionadas.'),
    dias: listaDeSelecao(7, 'Dias demais selecionados.', PRIMEIRO_DIA, ULTIMO_DIA),
    horarios: listaDeSelecao(60, 'Horários demais selecionados.'),
    apenasSemLocal: z.preprocess((valor) => {
        if (valor === undefined || valor === null || valor === '') return false;
        if (typeof valor === 'boolean') return valor;
        return ['1', 'on', 'true', 'sim'].includes(String(valor).trim().toLowerCase());
    }, z.boolean()),
});

/** Copia de uma aula para outro slot (e, opcionalmente, para outra turma). */
const schemaCopiar = z.object({
    turmaId: idOpcional('Selecione uma turma válida.'),
    diaSemana,
    horarioTurnoId: idOpcional('Selecione um horário válido.'),
});

const textoOpcional = (limite, mensagem) =>
    z.preprocess(
        paraNulo,
        z.string({ error: mensagem }).trim().max(limite, { error: mensagem }).nullable()
    );

const booleanoOpcional = z.preprocess((valor) => {
    if (valor === undefined || valor === null || valor === '') return null;
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor).trim().toLowerCase();
    if (['1', 'true', 'sim', 'ativo', 'ativos'].includes(texto)) return true;
    if (['0', 'false', 'nao', 'não', 'inativo', 'inativos'].includes(texto)) return false;
    return null;
}, z.boolean().nullable());

/** Filtros de listagem/pendencias. Todos opcionais. */
const schemaFiltros = z.object({
    turmaId: idOpcional('Turma inválida.'),
    cursoId: idOpcional('Curso inválido.'),
    campusId: idOpcional('Campus inválido.'),
    periodoLetivoId: idOpcional('Período letivo inválido.'),
    turnoId: idOpcional('Turno inválido.'),
    professorId: idOpcional('Professor inválido.'),
    disciplinaId: idOpcional('Disciplina inválida.'),
    localId: idOpcional('Local inválido.'),
    horarioTurnoId: idOpcional('Horário inválido.'),
    diaSemana: z.preprocess(
        paraNulo,
        z.coerce
            .number({ error: 'Dia da semana inválido.' })
            .int({ error: 'Dia da semana inválido.' })
            .min(PRIMEIRO_DIA, { error: 'Dia da semana inválido.' })
            .max(ULTIMO_DIA, { error: 'Dia da semana inválido.' })
            .nullable()
    ),
    modalidade: z.preprocess(
        paraNulo,
        z.enum(VALORES_MODALIDADE, { error: 'Modalidade inválida.' }).nullable()
    ),
    ativo: booleanoOpcional,
    busca: textoOpcional(120, 'Busca muito longa.'),
    pagina: z.preprocess(
        paraNulo,
        z.coerce.number({ error: 'Página inválida.' }).int().positive().nullable()
    ),
    porPagina: z.preprocess(
        paraNulo,
        z.coerce
            .number({ error: 'Itens por página inválido.' })
            .int()
            .positive()
            .max(200)
            .nullable()
    ),
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
    schemaAula,
    schemaMover,
    schemaCopiar,
    schemaLocalEmLote,
    schemaFiltros,
    validar,
};
