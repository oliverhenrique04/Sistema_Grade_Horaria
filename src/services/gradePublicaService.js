/**
 * Regras da consulta publica da grade horaria.
 *
 * Entrega a view pronta para imprimir: nenhuma decisao de negocio (filtro
 * encadeado, agrupamento, rotulo, aula sem horario) sobra para o EJS.
 *
 * Encadeamento dos filtros — cada lista e limitada apenas pelos filtros
 * anteriores da cadeia, o que evita dependencia circular entre eles:
 *
 *     periodo -> campus -> curso -> semestre -> turno -> turma
 *
 * Um filtro cujo valor nao esteja na lista disponivel e simplesmente
 * descartado (ex.: curso que nao existe no campus escolhido).
 */
const repositorio = require('../repositories/gradePublicaRepository');
const { nomeDoDia, curtoDoDia, siglaDoDia } = require('../utils/dias');
const {
    hora,
    faixaHoraria,
    ordinal,
    semestreRotulo,
    modalidadeRotulo,
    tipoLocalRotulo,
    MODALIDADES,
} = require('../utils/formatadores');

/** Filtros minimos para exibir a grade (mesma exigencia da versao anterior). */
const FILTROS_OBRIGATORIOS = [
    { chave: 'campusId', rotulo: 'campus' },
    { chave: 'cursoId', rotulo: 'curso' },
];

const ICONE_POR_MODALIDADE = new Map(MODALIDADES.map((item) => [item.valor, item.icone]));

/**
 * Converte um texto em slug comparavel ("Águas Claras" -> "aguas-claras").
 * Mesma regra usada pela area publica antiga, o que permite reconhecer os
 * links ja divulgados aos alunos.
 * @param {string} [valor]
 * @returns {string}
 */
const paraSlug = (valor = '') =>
    String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/** Localiza um item da lista pelo id, tolerando id ausente ou inexistente. */
const encontrarPorId = (lista = [], id) => {
    if (id === undefined || id === null) return null;
    return lista.find((item) => Number(item.id) === Number(id)) || null;
};

/**
 * Escolhe o periodo letivo da consulta: o pedido na URL quando valido, senao o
 * periodo corrente do banco. O codigo do periodo nunca vem fixo do HTML.
 */
const escolherPeriodo = (periodos = [], periodoId) => {
    const pedido = encontrarPorId(periodos, periodoId);
    if (pedido) return pedido;
    return periodos.find((item) => item.atual) || periodos[0] || null;
};

/** Normaliza o turno para uso na view (sem colunas cruas do banco). */
const paraTurno = (linha) => ({
    id: Number(linha.turno_id ?? linha.id),
    nome: linha.turno_nome ?? linha.nome,
    slug: linha.turno_slug ?? linha.slug,
    icone: linha.turno_icone ?? linha.icone ?? 'fa-clock',
    temaClass: linha.turno_tema ?? linha.tema_class ?? '',
});

/** Estrutura de uma turma na grade, ainda sem aulas. */
const paraTurma = (linha) => ({
    id: Number(linha.turma_id),
    nome: linha.turma_nome,
    codigo: linha.turma_codigo || '',
    semestre:
        linha.semestre_curricular === null || linha.semestre_curricular === undefined
            ? null
            : Number(linha.semestre_curricular),
    semestreRotulo: semestreRotulo(linha.semestre_curricular),
    curso: {
        id: Number(linha.curso_id),
        nome: linha.curso_nome,
        sigla: linha.curso_sigla || '',
        coordenador: linha.curso_coordenador || '',
    },
    campus: {
        id: Number(linha.campus_id),
        nome: linha.campus_nome,
        sigla: linha.campus_sigla || '',
    },
    turno: paraTurno(linha),
    periodo: { id: Number(linha.periodo_id), codigo: linha.periodo_codigo },
    dias: [],
    pendentes: [],
    totalAulas: 0,
});

/**
 * Estrutura de uma aula ja formatada. Campos administrativos (observacao,
 * e-mail do professor, ids de disciplina/professor/local) ficam de fora.
 */
const paraAula = (linha) => {
    const temHorario = Boolean(linha.horario_id);

    return {
        id: Number(linha.aula_id),
        diaSemana: Number(linha.dia_semana),
        diaNome: nomeDoDia(linha.dia_semana),
        diaCurto: curtoDoDia(linha.dia_semana),
        diaSigla: siglaDoDia(linha.dia_semana),
        temHorario,
        horarioNome: temHorario ? linha.horario_nome : '',
        horaInicio: temHorario ? hora(linha.hora_inicio) : '',
        horaFim: temHorario ? hora(linha.hora_fim) : '',
        faixaHoraria: temHorario ? faixaHoraria(linha.hora_inicio, linha.hora_fim) : '',
        disciplina: linha.disciplina_nome,
        professor: linha.professor_nome || '',
        local: linha.local_nome || '',
        localTipo: linha.local_tipo ? tipoLocalRotulo(linha.local_tipo) : '',
        modalidade: linha.modalidade,
        modalidadeRotulo: modalidadeRotulo(linha.modalidade),
        modalidadeIcone: ICONE_POR_MODALIDADE.get(linha.modalidade) || 'fa-circle-info',
    };
};

/**
 * Insere a aula no dia correspondente da lista, criando o dia quando preciso.
 * As linhas chegam ordenadas por dia, entao basta anexar ao final.
 */
const adicionarNoDia = (lista, aula) => {
    let dia = lista.find((item) => item.valor === aula.diaSemana);

    if (!dia) {
        dia = {
            valor: aula.diaSemana,
            nome: aula.diaNome,
            curto: aula.diaCurto,
            sigla: aula.diaSigla,
            aulas: [],
        };
        lista.push(dia);
    }

    dia.aulas.push(aula);
};

/**
 * Junta turmas e aulas e agrupa por turno -> turma -> dia.
 * Turmas sem aula continuam na lista (a view mostra o estado vazio) e aulas
 * sem horario vao para `pendentes`, exibidas no bloco "Horário a definir".
 *
 * @param {Array<object>} linhasTurmas
 * @param {Array<object>} linhasAulas
 * @returns {Array<{turno:object, turmas:Array<object>}>}
 */
const agrupar = (linhasTurmas = [], linhasAulas = []) => {
    const turmasPorId = new Map();

    linhasTurmas.forEach((linha) => {
        turmasPorId.set(Number(linha.turma_id), paraTurma(linha));
    });

    linhasAulas.forEach((linha) => {
        const turma = turmasPorId.get(Number(linha.turma_id));
        if (!turma) return;

        const aula = paraAula(linha);
        adicionarNoDia(aula.temHorario ? turma.dias : turma.pendentes, aula);
        turma.totalAulas += 1;
    });

    const grupos = [];
    const indicePorTurno = new Map();

    turmasPorId.forEach((turma) => {
        if (!indicePorTurno.has(turma.turno.id)) {
            indicePorTurno.set(turma.turno.id, grupos.length);
            grupos.push({ turno: turma.turno, turmas: [] });
        }
        grupos[indicePorTurno.get(turma.turno.id)].turmas.push(turma);
    });

    return grupos;
};

/**
 * Monta a consulta publica completa a partir dos filtros ja saneados.
 *
 * @param {{periodoId?:number, campusId?:number, cursoId?:number, semestre?:number,
 *          turnoId?:number, turmaId?:number}} [filtros]
 * @returns {Promise<{opcoes:object, filtrosAplicados:object, turmas:Array<object>,
 *                    totalAulas:number, precisaSelecionar:boolean}>}
 */
const montarConsulta = async (filtros = {}) => {
    const periodos = await repositorio.listarPeriodos();
    const periodo = escolherPeriodo(periodos, filtros.periodoId);
    const periodoId = periodo ? Number(periodo.id) : undefined;

    const listaCampus = await repositorio.listarCampus({ periodoId });
    const campus = encontrarPorId(listaCampus, filtros.campusId);
    const campusId = campus ? Number(campus.id) : undefined;

    const listaCursos = await repositorio.listarCursos({ periodoId, campusId });
    const curso = encontrarPorId(listaCursos, filtros.cursoId);
    const cursoId = curso ? Number(curso.id) : undefined;

    const listaSemestres = await repositorio.listarSemestres({ periodoId, campusId, cursoId });
    const semestre = listaSemestres.includes(Number(filtros.semestre))
        ? Number(filtros.semestre)
        : undefined;

    const listaTurnos = await repositorio.listarTurnos({
        periodoId,
        campusId,
        cursoId,
        semestre,
    });
    const turnoBruto = encontrarPorId(listaTurnos, filtros.turnoId);
    const turnoId = turnoBruto ? Number(turnoBruto.id) : undefined;

    const recorte = { periodoId, campusId, cursoId, semestre, turnoId };
    const listaTurmas = await repositorio.listarTurmas(recorte);
    const turmaEscolhida = listaTurmas.find(
        (linha) => Number(linha.turma_id) === Number(filtros.turmaId)
    );
    const turmaId = turmaEscolhida ? Number(turmaEscolhida.turma_id) : undefined;

    const escolhidos = { campusId, cursoId };
    const faltando = FILTROS_OBRIGATORIOS.filter((item) => !escolhidos[item.chave]).map(
        (item) => item.rotulo
    );

    const precisaSelecionar = faltando.length > 0;

    const filtrosAplicados = {
        periodoId,
        periodo: periodo ? { id: Number(periodo.id), codigo: periodo.codigo } : null,
        campusId,
        campus: campus ? { id: Number(campus.id), nome: campus.nome, sigla: campus.sigla } : null,
        cursoId,
        curso: curso
            ? {
                  id: Number(curso.id),
                  nome: curso.nome,
                  sigla: curso.sigla || '',
                  coordenador: curso.coordenador || '',
              }
            : null,
        semestre,
        semestreRotulo: semestre ? ordinal(semestre) : '',
        turnoId,
        turno: turnoBruto ? paraTurno(turnoBruto) : null,
        turmaId,
        turma: turmaEscolhida
            ? { id: Number(turmaEscolhida.turma_id), nome: turmaEscolhida.turma_nome }
            : null,
        faltando,
    };

    const opcoes = {
        periodos: periodos.map((item) => ({
            id: Number(item.id),
            codigo: item.codigo,
            atual: Boolean(item.atual),
        })),
        campus: listaCampus.map((item) => ({
            id: Number(item.id),
            nome: item.nome,
            sigla: item.sigla || '',
        })),
        cursos: listaCursos.map((item) => ({
            id: Number(item.id),
            nome: item.nome,
            sigla: item.sigla || '',
        })),
        semestres: listaSemestres.map((valor) => ({ valor, rotulo: ordinal(valor) })),
        turnos: listaTurnos.map(paraTurno),
        turmas: listaTurmas.map((linha) => ({
            id: Number(linha.turma_id),
            nome: linha.turma_nome,
        })),
    };

    if (precisaSelecionar) {
        return { opcoes, filtrosAplicados, turmas: [], totalAulas: 0, precisaSelecionar };
    }

    const recorteFinal = { ...recorte, turmaId };
    const linhasTurmas = turmaId
        ? listaTurmas.filter((linha) => Number(linha.turma_id) === turmaId)
        : listaTurmas;
    const linhasAulas = await repositorio.listarAulas(recorteFinal);

    return {
        opcoes,
        filtrosAplicados,
        turmas: agrupar(linhasTurmas, linhasAulas),
        totalAulas: linhasAulas.length,
        precisaSelecionar,
    };
};

/**
 * Traduz os parametros da area publica antiga (`?unidade=<slug>&curso=<slug>`)
 * para os ids do modelo atual. Slug nao reconhecido vira `undefined` — o
 * controlador redireciona mesmo assim, apenas sem o filtro correspondente.
 *
 * @param {{unidadeSlug?:string, cursoSlug?:string, periodoId?:number}} entrada
 * @returns {Promise<{campusId?:number, cursoId?:number}>}
 */
const resolverFiltrosLegados = async ({ unidadeSlug, cursoSlug, periodoId } = {}) => {
    const periodos = await repositorio.listarPeriodos();
    const periodo = escolherPeriodo(periodos, periodoId);
    const periodoDaBusca = periodo ? Number(periodo.id) : undefined;

    const combina = (item, slug) =>
        paraSlug(item.nome) === slug || (item.sigla && paraSlug(item.sigla) === slug);

    const listaCampus = await repositorio.listarCampus({ periodoId: periodoDaBusca });
    const campus = unidadeSlug ? listaCampus.find((item) => combina(item, unidadeSlug)) : null;
    const campusId = campus ? Number(campus.id) : undefined;

    const listaCursos = await repositorio.listarCursos({ periodoId: periodoDaBusca, campusId });
    const curso = cursoSlug ? listaCursos.find((item) => combina(item, cursoSlug)) : null;

    return { campusId, cursoId: curso ? Number(curso.id) : undefined };
};

module.exports = {
    montarConsulta,
    resolverFiltrosLegados,
    paraSlug,
};
