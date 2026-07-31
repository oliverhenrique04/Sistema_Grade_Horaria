/**
 * Todo o SQL da area publica de consulta da grade horaria.
 *
 * Duas regras valem para o arquivo inteiro:
 *
 * 1. Nada de dado inativo. Periodo letivo, campus, curso, turno, turma e aula
 *    precisam estar `ativo`; professor, local e horario inativos sao tratados
 *    como "nao informados" (LEFT JOIN condicionado), nunca exibidos.
 * 2. Nada de dado administrativo. As consultas selecionam apenas as colunas
 *    necessarias ao aluno — sem e-mail de professor, sem observacao da aula,
 *    sem capacidade de sala, sem carimbos de auditoria.
 *
 * As listas de opcoes derivam das turmas realmente publicadas: um campus sem
 * turma ativa nao aparece no filtro, evitando combinacoes sem resultado.
 */
const db = require('../config/db');

/**
 * Origem comum das turmas visiveis publicamente. Toda opcao de filtro e toda
 * consulta de grade partem daqui.
 */
/**
 * Turma gerencial fica de fora da consulta publica: ela e o registro interno
 * onde mora a disciplina compartilhada, e essa disciplina ja chega ao aluno pela
 * turma regular dele, no semestre certo. Exibi-la tambem duplicaria a aula na
 * tela e faria o aluno procurar por um codigo que ele nao conhece ("GPDIRM").
 */
const ORIGEM_TURMAS = `
      FROM turmas t
      JOIN periodos_letivos pl ON pl.id = t.periodo_letivo_id AND pl.ativo
      JOIN campus ca ON ca.id = t.campus_id AND ca.ativo
      JOIN cursos cu ON cu.id = t.curso_id AND cu.ativo
      JOIN turnos tn ON tn.id = t.turno_id AND tn.ativo
     WHERE t.ativo AND NOT t.gerencial
`;

/**
 * Origem das aulas visiveis publicamente.
 *
 * A aula e alcancada por `vw_aulas_das_turmas`, e nao por `a.turma_id`: assim a
 * disciplina compartilhada — registrada uma unica vez na turma gerencial —
 * aparece na grade de cada turma que a cursa, com o semestre daquela turma.
 *
 * `disciplinas` entra com JOIN simples: o nome da disciplina e o conteudo da
 * aula e some junto com ela se a aula for desativada. Ja `horarios_turno`,
 * `professores` e `locais` sao condicionados a `ativo` — quando o vinculo esta
 * desativado a aula continua na grade, apenas sem aquela informacao (aula sem
 * horario cai no bloco "Horário a definir").
 */
const ORIGEM_AULAS = `
      FROM aulas a
      JOIN vw_aulas_das_turmas v ON v.aula_id = a.id
      JOIN turmas t ON t.id = v.turma_id AND t.ativo AND NOT t.gerencial
      JOIN periodos_letivos pl ON pl.id = t.periodo_letivo_id AND pl.ativo
      JOIN campus ca ON ca.id = t.campus_id AND ca.ativo
      JOIN cursos cu ON cu.id = t.curso_id AND cu.ativo
      JOIN turnos tn ON tn.id = t.turno_id AND tn.ativo
      JOIN disciplinas d ON d.id = a.disciplina_id
 LEFT JOIN horarios_turno h ON h.id = a.horario_turno_id AND h.ativo
 LEFT JOIN professores p ON p.id = a.professor_id AND p.ativo
 LEFT JOIN locais l ON l.id = a.local_id AND l.ativo
     WHERE a.ativo
`;

/** Colunas de identificacao da turma reaproveitadas nas duas consultas. */
const COLUNAS_CONTEXTO = `
           cu.id AS curso_id,
           cu.nome AS curso_nome,
           cu.sigla AS curso_sigla,
           cu.coordenador AS curso_coordenador,
           ca.id AS campus_id,
           ca.nome AS campus_nome,
           ca.sigla AS campus_sigla,
           tn.id AS turno_id,
           tn.nome AS turno_nome,
           tn.slug AS turno_slug,
           tn.icone AS turno_icone,
           tn.tema_class AS turno_tema,
           tn.ordem AS turno_ordem,
           pl.id AS periodo_id,
           pl.codigo AS periodo_codigo
`;

/**
 * Monta as condicoes de filtro sobre `turmas`. Somente os placeholders
 * (`$1`, `$2`, ...) sao interpolados no SQL; os valores vao sempre pelo array
 * de parametros. As colunas sao literais deste arquivo, nunca entrada externa.
 *
 * @param {object} filtros
 * @param {any[]} parametros array acumulador (alterado no lugar)
 * @returns {string} trecho pronto para concatenar apos o WHERE da origem
 */
const montarFiltros = (filtros = {}, parametros = []) => {
    const partes = [];

    const adicionar = (coluna, valor) => {
        if (valor === undefined || valor === null || valor === '') return;
        parametros.push(valor);
        partes.push(`${coluna} = $${parametros.length}`);
    };

    adicionar('t.periodo_letivo_id', filtros.periodoId);
    adicionar('t.campus_id', filtros.campusId);
    adicionar('t.curso_id', filtros.cursoId);
    adicionar('t.semestre_curricular', filtros.semestre);
    adicionar('t.turno_id', filtros.turnoId);
    adicionar('t.id', filtros.turmaId);

    return partes.length > 0 ? ` AND ${partes.join(' AND ')}` : '';
};

/**
 * Periodos letivos ativos, com o periodo corrente em primeiro lugar.
 * @returns {Promise<Array<{id:number, codigo:string, ano:number, semestre:number, atual:boolean}>>}
 */
const listarPeriodos = async () => {
    const resultado = await db.query(
        `SELECT id, codigo, ano, semestre, atual
           FROM periodos_letivos
          WHERE ativo
          ORDER BY atual DESC, ano DESC, semestre DESC, codigo DESC`
    );
    return resultado.rows;
};

/**
 * Campus com ao menos uma turma publicada.
 * @param {{periodoId?:number}} [filtros]
 * @returns {Promise<Array<{id:number, nome:string, sigla:string|null}>>}
 */
const listarCampus = async ({ periodoId } = {}) => {
    const parametros = [];
    const condicoes = montarFiltros({ periodoId }, parametros);

    const resultado = await db.query(
        `SELECT DISTINCT ca.id, ca.nome, ca.sigla
         ${ORIGEM_TURMAS} ${condicoes}
          ORDER BY ca.nome`,
        parametros
    );
    return resultado.rows;
};

/**
 * Cursos com turma publicada, limitados ao periodo e ao campus escolhidos.
 * @param {{periodoId?:number, campusId?:number}} [filtros]
 * @returns {Promise<Array<{id:number, nome:string, sigla:string|null, coordenador:string|null}>>}
 */
const listarCursos = async ({ periodoId, campusId } = {}) => {
    const parametros = [];
    const condicoes = montarFiltros({ periodoId, campusId }, parametros);

    const resultado = await db.query(
        `SELECT DISTINCT cu.id, cu.nome, cu.sigla, cu.coordenador
         ${ORIGEM_TURMAS} ${condicoes}
          ORDER BY cu.nome`,
        parametros
    );
    return resultado.rows;
};

/**
 * Semestres curriculares que possuem turma publicada.
 * @param {{periodoId?:number, campusId?:number, cursoId?:number}} [filtros]
 * @returns {Promise<number[]>}
 */
const listarSemestres = async ({ periodoId, campusId, cursoId } = {}) => {
    const parametros = [];
    const condicoes = montarFiltros({ periodoId, campusId, cursoId }, parametros);

    const resultado = await db.query(
        `SELECT DISTINCT t.semestre_curricular AS semestre
         ${ORIGEM_TURMAS} ${condicoes}
          ORDER BY semestre`,
        parametros
    );
    return resultado.rows.map((linha) => Number(linha.semestre));
};

/**
 * Turnos que possuem turma publicada dentro do recorte informado.
 * @param {{periodoId?:number, campusId?:number, cursoId?:number, semestre?:number}} [filtros]
 * @returns {Promise<Array<object>>}
 */
const listarTurnos = async ({ periodoId, campusId, cursoId, semestre } = {}) => {
    const parametros = [];
    const condicoes = montarFiltros({ periodoId, campusId, cursoId, semestre }, parametros);

    const resultado = await db.query(
        `SELECT DISTINCT tn.id, tn.nome, tn.slug, tn.icone, tn.tema_class, tn.ordem
         ${ORIGEM_TURMAS} ${condicoes}
          ORDER BY tn.ordem, tn.nome`,
        parametros
    );
    return resultado.rows;
};

/**
 * Turmas publicadas, ja com curso, campus, turno e periodo resolvidos.
 * A ordem (turno, curso, semestre, nome) e a mesma usada na exibicao.
 * @param {{periodoId?:number, campusId?:number, cursoId?:number, semestre?:number,
 *          turnoId?:number, turmaId?:number}} [filtros]
 * @returns {Promise<Array<object>>}
 */
const listarTurmas = async (filtros = {}) => {
    const parametros = [];
    const condicoes = montarFiltros(filtros, parametros);

    const resultado = await db.query(
        `SELECT t.id AS turma_id,
                t.nome AS turma_nome,
                t.codigo AS turma_codigo,
                t.semestre_curricular,
                ${COLUNAS_CONTEXTO}
         ${ORIGEM_TURMAS} ${condicoes}
          ORDER BY tn.ordem, tn.nome, cu.nome, t.semestre_curricular, t.nome, t.id`,
        parametros
    );
    return resultado.rows;
};

/**
 * Aulas publicadas no recorte informado, ordenadas por turno, turma, dia da
 * semana e ordem do horario. Aulas sem horario vao para o fim de cada dia
 * (NULLS LAST) e sao separadas em bloco proprio pelo servico.
 * @param {{periodoId?:number, campusId?:number, cursoId?:number, semestre?:number,
 *          turnoId?:number, turmaId?:number}} [filtros]
 * @returns {Promise<Array<object>>}
 */
const listarAulas = async (filtros = {}) => {
    const parametros = [];
    const condicoes = montarFiltros(filtros, parametros);

    const resultado = await db.query(
        `SELECT a.id AS aula_id,
                a.dia_semana,
                a.modalidade,
                t.id AS turma_id,
                t.nome AS turma_nome,
                t.semestre_curricular,
                h.id AS horario_id,
                h.nome AS horario_nome,
                h.ordem AS horario_ordem,
                h.hora_inicio,
                h.hora_fim,
                d.nome AS disciplina_nome,
                p.nome AS professor_nome,
                l.nome AS local_nome,
                l.tipo AS local_tipo,
                ${COLUNAS_CONTEXTO}
         ${ORIGEM_AULAS} ${condicoes}
          ORDER BY tn.ordem, tn.nome, cu.nome, t.semestre_curricular, t.nome, t.id,
                   a.dia_semana, h.ordem NULLS LAST, h.hora_inicio NULLS LAST,
                   d.nome, a.id`,
        parametros
    );
    return resultado.rows;
};

module.exports = {
    listarPeriodos,
    listarCampus,
    listarCursos,
    listarSemestres,
    listarTurnos,
    listarTurmas,
    listarAulas,
};
