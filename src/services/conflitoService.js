/**
 * Regras de conflito da grade horaria.
 *
 * Este modulo e a peca central do sistema: nenhuma aula e gravada sem passar por
 * `verificarConflitos`. Ele NUNCA lanca excecao por conflito - devolve a lista
 * completa de problemas para que a interface mostre todos de uma vez.
 *
 * Regras validadas:
 *  1. Turma       - a mesma turma nao pode ter duas aulas no mesmo dia/horario
 *                   (turma gerencial e a excecao: nela so a repeticao da mesma
 *                   disciplina e conflito - ver `conflitoDeTurma`);
 *  2. Professor   - o mesmo professor nao pode dar duas aulas simultaneas, ainda
 *                   que em cursos, turmas ou campus diferentes;
 *  3. Local       - o mesmo local nao pode receber duas aulas simultaneas
 *                   (excecao: locais do tipo `virtual`, usados por EAD);
 *  4. Turno       - o horario escolhido precisa pertencer ao turno da turma;
 *  5. Campus      - o local precisa ser do campus da turma (excecao: `virtual`);
 *  6. Inativos    - turma, curso, disciplina, professor, local, turno e horario
 *                   precisam estar ativos;
 *  7. Dia         - segunda (1) a sabado (6).
 *
 * As regras 1, 2 e 3 comparam a FAIXA REAL de horario (`hora_inicio`/`hora_fim`)
 * e nao o `horario_turno_id`. O 5o horario do Matutino (10:40-11:30) e o 5o do
 * Integral (10:40-11:30) sao registros diferentes que ocupam o mesmo tempo de
 * relogio; comparar ids deixaria passar um choque real de agenda.
 *
 * Aulas sem horario (`horarioTurnoId` nulo) sao permitidas e viram pendencia: as
 * regras 1 a 4 nao se aplicam (nao ha como calcular sobreposicao), mas 5, 6 e 7
 * continuam valendo.
 */
const db = require('../config/db');
const aulaRepository = require('../repositories/aulaRepository');
const { nomeDoDia, diaValido, ULTIMO_DIA } = require('../utils/dias');
const { faixaHoraria } = require('../utils/formatadores');

/**
 * @typedef {Object} Conflito
 * @property {'turma'|'professor'|'local'|'turno'|'campus'|'inativo'} tipo
 * @property {string} mensagem Texto pronto para exibicao ao usuario
 * @property {number|null} aulaId Aula existente que gerou o conflito, quando houver
 */

/** Unico dia masculino da faixa util (sabado): "no sabado" e nao "na sabado". */
const DIAS_MASCULINOS = new Set([ULTIMO_DIA]);

/**
 * Dia da semana com preposicao: "na terça-feira", "no sábado".
 * @param {number} valor
 * @returns {string}
 */
const noDia = (valor) => {
    const nome = nomeDoDia(valor);
    if (!nome) return '';
    return `${DIAS_MASCULINOS.has(Number(valor)) ? 'no' : 'na'} ${nome.toLowerCase()}`;
};

/**
 * Identificacao curta da turma: prefere o codigo, cai para o nome.
 * @param {{codigo?:string|null, nome?:string|null}} turma
 * @returns {string}
 */
const rotuloTurma = (turma = {}) => turma.codigo || turma.nome || 'sem identificação';

/** Monta um conflito no formato do contrato. */
const conflito = (tipo, mensagem, aulaId = null) => ({
    tipo,
    mensagem,
    aulaId: aulaId === null || aulaId === undefined ? null : Number(aulaId),
});

/** Normaliza um id vindo de formulario ("", "0", "12") em inteiro ou null. */
const idOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
};

/**
 * Normaliza os dados de entrada, aceitando tanto o formato do validador
 * (`turmaId`) quanto o formato cru do banco (`turma_id`).
 * @param {object} dados
 * @returns {{turmaId:number|null, disciplinaId:number|null, professorId:number|null,
 *            localId:number|null, diaSemana:number|null, horarioTurnoId:number|null,
 *            modalidade:string}}
 */
const normalizar = (dados = {}) => ({
    turmaId: idOuNulo(dados.turmaId ?? dados.turma_id),
    disciplinaId: idOuNulo(dados.disciplinaId ?? dados.disciplina_id),
    professorId: idOuNulo(dados.professorId ?? dados.professor_id),
    localId: idOuNulo(dados.localId ?? dados.local_id),
    diaSemana: idOuNulo(dados.diaSemana ?? dados.dia_semana),
    horarioTurnoId: idOuNulo(dados.horarioTurnoId ?? dados.horario_turno_id),
    modalidade: dados.modalidade || 'presencial',
});

/**
 * Carrega o contexto (turma, disciplina, professor, local e horario) uma unica
 * vez para reaproveitar entre todas as regras.
 * @param {{query: Function}} executor
 * @param {object} dados
 * @returns {Promise<object>}
 */
const carregarContexto = (executor, dados) =>
    aulaRepository.contextoDaAula(normalizar(dados), executor || db);

/**
 * Reaproveita um contexto ja carregado ou carrega um novo.
 * @param {{query: Function}} executor
 * @param {object} dados
 * @param {object|null} contexto
 * @returns {Promise<object>}
 */
const obterContexto = async (executor, dados, contexto) =>
    contexto || carregarContexto(executor, dados);

// ---------------------------------------------------------------------------
// Regra 6 - registros inativos / inexistentes
// ---------------------------------------------------------------------------

/**
 * Registros exigidos por uma aula, na ordem em que aparecem para o usuario.
 * `pronome` deixa a mensagem correta em portugues ("ele"/"ela").
 */
const REGISTROS = [
    {
        chave: 'turma',
        rotulo: 'a turma',
        pronome: 'ela',
        nome: 'turma_nome_ou_codigo',
        ativo: 'turma_ativa',
    },
    {
        chave: 'curso',
        rotulo: 'o curso',
        pronome: 'ele',
        nome: 'turma_curso_nome',
        ativo: 'turma_curso_ativo',
    },
    {
        chave: 'turno',
        rotulo: 'o turno',
        pronome: 'ele',
        nome: 'turma_turno_nome',
        ativo: 'turma_turno_ativo',
    },
    {
        chave: 'disciplina',
        rotulo: 'a disciplina',
        pronome: 'ela',
        nome: 'disciplina_nome',
        ativo: 'disciplina_ativa',
    },
    {
        chave: 'professor',
        rotulo: 'o professor',
        pronome: 'ele',
        nome: 'professor_nome',
        ativo: 'professor_ativo',
    },
    { chave: 'local', rotulo: 'o local', pronome: 'ele', nome: 'local_nome', ativo: 'local_ativo' },
    {
        chave: 'horario',
        rotulo: 'o horário',
        pronome: 'ele',
        nome: 'horario_descricao',
        ativo: 'horario_ativo',
    },
];

/**
 * Verifica se todos os registros referenciados existem e estao ativos.
 *
 * Tambem detecta ids inexistentes (o contexto volta com colunas nulas), o que
 * evita um erro cru de chave estrangeira na hora de gravar.
 *
 * @param {{query: Function}} executor cliente de transacao ou o modulo `db`
 * @param {object} dadosAula
 * @param {{contexto?: object|null}} [opcoes]
 * @returns {Promise<Conflito[]>}
 */
const validarRegistrosAtivos = async (executor, dadosAula, { contexto = null } = {}) => {
    const dados = normalizar(dadosAula);
    const ctx = await obterContexto(executor, dados, contexto);

    const informados = {
        turma: dados.turmaId,
        curso: dados.turmaId,
        turno: dados.turmaId,
        disciplina: dados.disciplinaId,
        professor: dados.professorId,
        local: dados.localId,
        horario: dados.horarioTurnoId,
    };

    const nomes = {
        turma_nome_ou_codigo: rotuloTurma({ codigo: ctx.turma_codigo, nome: ctx.turma_nome }),
        turma_curso_nome: ctx.turma_curso_nome,
        turma_turno_nome: ctx.turma_turno_nome,
        disciplina_nome: ctx.disciplina_nome,
        professor_nome: ctx.professor_nome,
        local_nome: ctx.local_nome,
        horario_descricao: ctx.horario_nome
            ? `${ctx.horario_nome} (${faixaHoraria(ctx.hora_inicio, ctx.hora_fim)})`
            : null,
    };

    // A turma nao existe: sem ela nao ha curso nem turno para avaliar.
    if (informados.turma && !ctx.turma_id) {
        return [conflito('inativo', 'A turma informada não foi encontrada.')];
    }

    const conflitos = [];

    REGISTROS.forEach((registro) => {
        if (!informados[registro.chave]) return;

        const nome = nomes[registro.nome];
        const ativo = ctx[registro.ativo];

        if (nome === null || nome === undefined) {
            conflitos.push(
                conflito('inativo', `Não foi possível encontrar ${registro.rotulo} informado.`)
            );
            return;
        }

        if (ativo === false) {
            conflitos.push(
                conflito(
                    'inativo',
                    `Não é possível usar ${registro.rotulo} ${nome} porque ${registro.pronome} está inativo.`
                )
            );
        }
    });

    return conflitos;
};

// ---------------------------------------------------------------------------
// Regra 4 - turno do horario
// ---------------------------------------------------------------------------

/**
 * Garante que o horario escolhido pertence ao turno da turma.
 * @param {{query: Function}} executor
 * @param {object} dadosAula
 * @param {{contexto?: object|null}} [opcoes]
 * @returns {Promise<Conflito[]>}
 */
const validarTurnoDoHorario = async (executor, dadosAula, { contexto = null } = {}) => {
    const dados = normalizar(dadosAula);
    if (!dados.horarioTurnoId) return [];

    const ctx = await obterContexto(executor, dados, contexto);
    if (!ctx.horario_id || !ctx.turma_id) return [];

    if (Number(ctx.horario_turno_id) === Number(ctx.turma_turno_id)) return [];

    return [
        conflito(
            'turno',
            `O horário selecionado pertence ao turno ${ctx.horario_turno_nome}, mas a turma ` +
                `${rotuloTurma({ codigo: ctx.turma_codigo, nome: ctx.turma_nome })} é do turno ` +
                `${ctx.turma_turno_nome}.`
        ),
    ];
};

// ---------------------------------------------------------------------------
// Regra 5 - campus do local
// ---------------------------------------------------------------------------

/**
 * Garante que o local pertence ao campus da turma. Locais `virtual` (EAD) sao
 * exceção: nao pertencem fisicamente a nenhum campus.
 * @param {{query: Function}} executor
 * @param {object} dadosAula
 * @param {{contexto?: object|null}} [opcoes]
 * @returns {Promise<Conflito[]>}
 */
const validarCampusDoLocal = async (executor, dadosAula, { contexto = null } = {}) => {
    const dados = normalizar(dadosAula);
    if (!dados.localId) return [];

    const ctx = await obterContexto(executor, dados, contexto);
    if (!ctx.local_id || !ctx.turma_id) return [];
    if (ctx.local_tipo === 'virtual') return [];
    if (Number(ctx.local_campus_id) === Number(ctx.turma_campus_id)) return [];

    return [
        conflito(
            'campus',
            `O local ${ctx.local_nome} pertence ao campus ${ctx.local_campus_nome}, mas a turma ` +
                `${rotuloTurma({ codigo: ctx.turma_codigo, nome: ctx.turma_nome })} é do campus ` +
                `${ctx.turma_campus_nome}.`
        ),
    ];
};

// ---------------------------------------------------------------------------
// Regra 1 - turma
// ---------------------------------------------------------------------------

/**
 * Conflito da propria turma: duas aulas ativas no mesmo dia e faixa de horario.
 *
 * EXCECAO DA TURMA AGRUPADORA: uma turma gerencial nao e uma turma de alunos, e
 * o balcao onde ficam as disciplinas compartilhadas por varias turmas. As quatro
 * optativas que ela oferta as 08:50 de segunda sao aulas de turmas diferentes, e
 * nao um choque de agenda. Nela, so a repeticao da MESMA disciplina no mesmo
 * horario e conflito — que e exatamente o que o indice `ux_aula_turma_slot`
 * barra no banco.
 *
 * @param {{query: Function}} executor
 * @param {object} dadosAula
 * @param {{ignorarAulaId?: number|null, bloquear?: boolean, contexto?: object|null}} [opcoes]
 * @returns {Promise<Conflito[]>} array com no maximo um item
 */
const conflitoDeTurma = async (
    executor,
    dadosAula,
    { ignorarAulaId = null, bloquear = false, contexto = null } = {}
) => {
    const dados = normalizar(dadosAula);
    if (!dados.turmaId || !dados.horarioTurnoId || !dados.diaSemana) return [];

    const ctx = await obterContexto(executor, dados, contexto);

    const todas = await aulaRepository.conflitanteDeTurma(
        {
            turmaId: dados.turmaId,
            diaSemana: dados.diaSemana,
            horarioTurnoId: dados.horarioTurnoId,
            ignorarAulaId,
            bloquear,
        },
        executor || db
    );

    const encontradas = ctx.turma_gerencial
        ? todas.filter((aula) => Number(aula.disciplina_id) === Number(dados.disciplinaId))
        : todas;

    if (encontradas.length === 0) return [];

    const existente = encontradas[0];

    const rotulo = rotuloTurma({ codigo: existente.turma_codigo, nome: existente.turma_nome });
    const quando = `${noDia(existente.dia_semana)}, das ${faixaHoraria(existente.hora_inicio, existente.hora_fim)}`;

    const mensagem = ctx.turma_gerencial
        ? `A turma gerencial ${rotulo} já oferta ${existente.disciplina_nome} ${quando}.`
        : `A turma ${rotulo} já possui aula ${quando} (${existente.disciplina_nome}).`;

    return [conflito('turma', mensagem, existente.id)];
};

// ---------------------------------------------------------------------------
// Regra 2 - professor
// ---------------------------------------------------------------------------

/**
 * Conflitos de agenda do professor, em qualquer turma, curso ou campus.
 * @param {{query: Function}} executor
 * @param {object} dadosAula
 * @param {{ignorarAulaId?: number|null, bloquear?: boolean, contexto?: object|null}} [opcoes]
 * @returns {Promise<Conflito[]>}
 */
const conflitosDeProfessor = async (
    executor,
    dadosAula,
    { ignorarAulaId = null, bloquear = false, contexto = null } = {}
) => {
    const dados = normalizar(dadosAula);
    if (!dados.professorId || !dados.horarioTurnoId || !dados.diaSemana) return [];

    const encontradas = await aulaRepository.conflitantesDeProfessor(
        {
            professorId: dados.professorId,
            diaSemana: dados.diaSemana,
            horarioTurnoId: dados.horarioTurnoId,
            ignorarAulaId,
            bloquear,
        },
        executor || db
    );

    if (encontradas.length === 0) return [];

    // O nome do professor vem da aula existente; se ela estiver sem professor
    // (impossivel neste filtro) cai para o contexto.
    const ctx = contexto || {};

    return encontradas.map((existente) =>
        conflito(
            'professor',
            `O professor ${existente.professor_nome || ctx.professor_nome} já possui aula ` +
                `${noDia(existente.dia_semana)}, das ` +
                `${faixaHoraria(existente.hora_inicio, existente.hora_fim)}, na turma ` +
                `${rotuloTurma({ codigo: existente.turma_codigo, nome: existente.turma_nome })}.`,
            existente.id
        )
    );
};

// ---------------------------------------------------------------------------
// Regra 3 - local
// ---------------------------------------------------------------------------

/**
 * Conflitos de ocupacao do local. Locais `virtual` nunca conflitam.
 * @param {{query: Function}} executor
 * @param {object} dadosAula
 * @param {{ignorarAulaId?: number|null, bloquear?: boolean, contexto?: object|null}} [opcoes]
 * @returns {Promise<Conflito[]>}
 */
const conflitosDeLocal = async (
    executor,
    dadosAula,
    { ignorarAulaId = null, bloquear = false, contexto = null } = {}
) => {
    const dados = normalizar(dadosAula);
    if (!dados.localId || !dados.horarioTurnoId || !dados.diaSemana) return [];

    // Ambiente virtual comporta varias turmas ao mesmo tempo (EAD).
    const ctx = await obterContexto(executor, dados, contexto);
    if (ctx.local_tipo === 'virtual') return [];

    const encontradas = await aulaRepository.conflitantesDeLocal(
        {
            localId: dados.localId,
            diaSemana: dados.diaSemana,
            horarioTurnoId: dados.horarioTurnoId,
            ignorarAulaId,
            bloquear,
        },
        executor || db
    );

    return encontradas.map((existente) =>
        conflito(
            'local',
            `O local ${existente.local_nome || ctx.local_nome} já está ocupado ` +
                `${noDia(existente.dia_semana)}, das ` +
                `${faixaHoraria(existente.hora_inicio, existente.hora_fim)}, pela turma ` +
                `${rotuloTurma({ codigo: existente.turma_codigo, nome: existente.turma_nome })}.`,
            existente.id
        )
    );
};

// ---------------------------------------------------------------------------
// Orquestracao
// ---------------------------------------------------------------------------

/**
 * Executa TODAS as regras e devolve todos os problemas encontrados.
 *
 * Nunca para no primeiro conflito: a interface precisa mostrar a lista completa.
 * Funciona tanto em pre-visualizacao (recebendo o modulo `db`) quanto dentro de
 * uma transacao (recebendo o `PoolClient`); no segundo caso `bloquear` aplica
 * `FOR NO KEY UPDATE` nas aulas concorrentes.
 *
 * @param {{query: Function}} cliente PoolClient em transacao ou o modulo `db`
 * @param {{turmaId:number, disciplinaId:number, professorId?:number|null,
 *          localId?:number|null, diaSemana:number, horarioTurnoId?:number|null,
 *          modalidade?:string}} dadosAula
 * @param {{ignorarAulaId?: number|null, bloquear?: boolean}} [opcoes]
 * @returns {Promise<Conflito[]>}
 */
const verificarConflitos = async (
    cliente,
    dadosAula,
    { ignorarAulaId = null, bloquear = false } = {}
) => {
    const executor = cliente || db;
    const dados = normalizar(dadosAula);
    const conflitos = [];

    // Regra 7 - dia da semana (segunda a sabado). Reportado como conflito de
    // turma porque e a agenda da turma que fica invalida.
    if (!diaValido(dados.diaSemana)) {
        conflitos.push(
            conflito(
                'turma',
                'Selecione um dia da semana entre segunda-feira e sábado para a aula.'
            )
        );
    }

    if (!dados.turmaId) {
        conflitos.push(conflito('inativo', 'Selecione a turma da aula.'));
        return conflitos;
    }

    const contexto = await carregarContexto(executor, dados);

    if (!contexto.turma_id) {
        conflitos.push(conflito('inativo', 'A turma informada não foi encontrada.'));
        return conflitos;
    }

    // Regra 6 - registros inativos ou inexistentes.
    conflitos.push(...(await validarRegistrosAtivos(executor, dados, { contexto })));

    // Regra 4 - turno do horario.
    conflitos.push(...(await validarTurnoDoHorario(executor, dados, { contexto })));

    // Regra 5 - campus do local.
    conflitos.push(...(await validarCampusDoLocal(executor, dados, { contexto })));

    // Sem horario a aula fica como pendencia: nao ha faixa para comparar.
    if (!dados.horarioTurnoId || !contexto.horario_id || !diaValido(dados.diaSemana)) {
        return conflitos;
    }

    // Sequencial de proposito: dentro de uma transacao as consultas rodam no
    // mesmo cliente e a ordem dos conflitos na lista fica previsivel.
    const opcoesBusca = { ignorarAulaId, bloquear, contexto };

    conflitos.push(...(await conflitoDeTurma(executor, dados, opcoesBusca)));
    conflitos.push(...(await conflitosDeProfessor(executor, dados, opcoesBusca)));
    conflitos.push(...(await conflitosDeLocal(executor, dados, opcoesBusca)));

    return conflitos;
};

module.exports = {
    verificarConflitos,
    conflitosDeProfessor,
    conflitosDeLocal,
    conflitoDeTurma,
    validarTurnoDoHorario,
    validarCampusDoLocal,
    validarRegistrosAtivos,
    carregarContexto,
    noDia,
    rotuloTurma,
};
