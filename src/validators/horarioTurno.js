/**
 * Validacao dos horarios (periodos) de um turno.
 *
 * A duracao fixa de 50 minutos e garantida pelo banco (CHECK
 * `ck_horario_duracao_50min`), mas tambem e validada aqui para que o usuario
 * receba a mensagem no proprio campo, antes de qualquer ida ao banco.
 *
 * A sobreposicao entre periodos ativos do mesmo turno depende dos demais
 * registros e por isso e validada no banco (gatilho
 * `tg_valida_sobreposicao_horario`); o servico traduz o erro em mensagem.
 *
 * As chaves do schema sao exatamente as colunas de `horarios_turno`.
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

/** Duracao obrigatoria de cada periodo, em minutos (espelha o CHECK do banco). */
const DURACAO_MINUTOS = 50;

const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

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

/**
 * Campo de hora do formulario (`<input type="time">` envia "HH:MM" ou
 * "HH:MM:SS"). Normaliza para "HH:MM".
 * @param {string} mensagem
 */
const campoHora = (mensagem) =>
    z.preprocess(
        paraIndefinido,
        z
            .string({ error: mensagem })
            .trim()
            .regex(HORA_REGEX, { error: mensagem })
            .transform((valor) => valor.slice(0, 5))
    );

/**
 * Converte "HH:MM" em minutos desde a meia-noite.
 * @param {string} texto
 * @returns {number}
 */
const paraMinutos = (texto) => {
    const [horas, minutos] = String(texto).split(':').map(Number);
    return horas * 60 + minutos;
};

/**
 * Soma minutos a uma hora "HH:MM", sem passar da meia-noite.
 * @param {string} texto
 * @param {number} minutos
 * @returns {string} "HH:MM" ou string vazia quando a hora e invalida
 */
const somarMinutos = (texto, minutos) => {
    if (!HORA_REGEX.test(String(texto || '').trim())) return '';
    const total = paraMinutos(texto) + minutos;
    if (total >= 24 * 60) return '';
    const horas = String(Math.floor(total / 60)).padStart(2, '0');
    const resto = String(total % 60).padStart(2, '0');
    return `${horas}:${resto}`;
};

/** Dados gravaveis de um periodo. */
const schemaHorario = z
    .object({
        turno_id: z.preprocess(
            paraIndefinido,
            z.coerce
                .number({ error: 'Selecione o turno.' })
                .int({ error: 'Selecione o turno.' })
                .positive({ error: 'Selecione o turno.' })
        ),
        nome: z.preprocess(
            paraIndefinido,
            z
                .string({ error: 'Informe o nome do horário (ex.: 1º horário).' })
                .trim()
                .min(1, { error: 'Informe o nome do horário (ex.: 1º horário).' })
                .max(60, { error: 'O nome deve ter no máximo 60 caracteres.' })
        ),
        ordem: z.preprocess(
            paraIndefinido,
            z.coerce
                .number({ error: 'Informe a ordem do horário dentro do turno.' })
                .int({ error: 'A ordem deve ser um número inteiro.' })
                .min(1, { error: 'A ordem deve ser maior ou igual a 1.' })
                .max(99, { error: 'A ordem deve ser no máximo 99.' })
        ),
        hora_inicio: campoHora('Informe a hora de início no formato HH:MM.'),
        hora_fim: campoHora('Informe a hora de término no formato HH:MM.'),
        ativo: ativoFormulario,
    })
    .superRefine((dados, contexto) => {
        const inicio = paraMinutos(dados.hora_inicio);
        const fim = paraMinutos(dados.hora_fim);

        if (fim <= inicio) {
            contexto.addIssue({
                code: 'custom',
                path: ['hora_fim'],
                message: 'A hora de término deve ser posterior à hora de início.',
            });
            return;
        }

        if (fim - inicio !== DURACAO_MINUTOS) {
            contexto.addIssue({
                code: 'custom',
                path: ['hora_fim'],
                message:
                    `Cada horário deve durar exatamente ${DURACAO_MINUTOS} minutos. ` +
                    `Começando às ${dados.hora_inicio}, o término deve ser ` +
                    `${somarMinutos(dados.hora_inicio, DURACAO_MINUTOS) || 'no mesmo dia'}.`,
            });
        }
    });

/**
 * Filtros da listagem. Valores invalidos viram "sem filtro" em vez de erro.
 */
const schemaFiltros = z.object({
    turno_id: z.preprocess(paraNulo, z.coerce.number().int().positive().nullable().catch(null)),
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
 * Valida o corpo do formulario de horario.
 * @param {Record<string, unknown>} corpo
 * @returns {{turno_id:number, nome:string, ordem:number, hora_inicio:string,
 *            hora_fim:string, ativo:boolean}}
 */
const validarHorario = (corpo = {}) =>
    validar(schemaHorario, {
        turno_id: corpo.turno_id,
        nome: corpo.nome,
        ordem: corpo.ordem,
        hora_inicio: corpo.hora_inicio,
        hora_fim: corpo.hora_fim,
        ativo: corpo.ativo,
    });

/**
 * Valida os filtros da listagem.
 * @param {Record<string, unknown>} query
 * @returns {{turno_id:number|null, busca:string|null, ativo:boolean|null}}
 */
const validarFiltros = (query = {}) =>
    validar(
        schemaFiltros,
        { turno_id: query.turno_id, busca: query.busca, ativo: query.ativo },
        'Filtros inválidos.'
    );

module.exports = {
    DURACAO_MINUTOS,
    schemaHorario,
    schemaFiltros,
    validar,
    validarHorario,
    validarFiltros,
    somarMinutos,
    paraMinutos,
};
