/**
 * Todo o SQL do painel de corredor (TVs dos blocos).
 *
 * Vale aqui a mesma disciplina da area publica: nada de dado inativo, nada de
 * dado administrativo, toda consulta parametrizada. As listas vem por
 * `= ANY($n::int[])` — array parametrizado, nunca `IN (...)` interpolado.
 *
 * A origem e `vw_aulas_das_turmas`, e nao `aulas.turma_id`: a disciplina
 * compartilhada, registrada uma unica vez na turma gerencial, precisa aparecer
 * com as turmas reais que a cursam. O servico depois colapsa as linhas por
 * `aula_id` — uma aula fisica, uma linha no painel.
 */
const db = require('../config/db');

/**
 * Origem das aulas visiveis no painel.
 *
 * Tres exclusoes, cada uma por um motivo diferente:
 *
 * - `NOT t.gerencial`: a turma gerencial e registro interno; quem cursa e a
 *   turma regular, que a view resolve.
 * - `l.tipo <> 'virtual'`: aula em ambiente virtual nao ocupa sala e ninguem
 *   se desloca ate um bloco para assisti-la. Hoje e por aqui que "EAD" e
 *   reconhecido — a coluna `modalidade` vale 'presencial' nas 1477 aulas do
 *   banco porque o cubo do TOTVS nao a preenche. `a.modalidade <> 'ead'` fica
 *   como criterio secundario, para o dia em que o ERP passar a preencher.
 * - `h.id IS NOT NULL`: aula sem horario nao tem quando aparecer num painel
 *   que e, inteiro, uma linha do tempo.
 */
const ORIGEM = `
      FROM aulas a
      JOIN vw_aulas_das_turmas v ON v.aula_id = a.id
      JOIN turmas t ON t.id = v.turma_id AND t.ativo AND NOT t.gerencial
      JOIN periodos_letivos pl ON pl.id = t.periodo_letivo_id AND pl.ativo
      JOIN campus ca ON ca.id = t.campus_id AND ca.ativo
      JOIN cursos cu ON cu.id = t.curso_id AND cu.ativo
      JOIN disciplinas d ON d.id = a.disciplina_id
      JOIN horarios_turno h ON h.id = a.horario_turno_id AND h.ativo
 LEFT JOIN professores p ON p.id = a.professor_id AND p.ativo
 LEFT JOIN locais l ON l.id = a.local_id AND l.ativo
     WHERE a.ativo
       AND a.modalidade <> 'ead'
       AND (l.tipo IS NULL OR l.tipo <> 'virtual')
`;

/**
 * Monta as condicoes do recorte. Somente placeholders entram no SQL; os valores
 * viajam sempre pelo array de parametros.
 *
 * A condicao de `locais` e a unica que aceita nulo de proposito: um link de
 * bloco precisa continuar mostrando as aulas ainda sem sala, senao a TV nasce
 * vazia e so enche quando o NAP terminar o ensalamento (hoje, 9 de 1477 aulas
 * tem local). `incluirSemLocal: false` desliga isso.
 *
 * @param {object} recorte
 * @param {any[]} parametros acumulador (alterado no lugar)
 * @returns {string}
 */
const montarFiltros = (recorte = {}, parametros = []) => {
    const partes = [];

    const igual = (coluna, valor) => {
        if (valor === undefined || valor === null || valor === '') return;
        parametros.push(valor);
        partes.push(`${coluna} = $${parametros.length}`);
    };

    const listaDe = (coluna, valores, { incluirNulo = false } = {}) => {
        if (!Array.isArray(valores) || valores.length === 0) return;
        parametros.push(valores);
        const condicao = `${coluna} = ANY($${parametros.length}::int[])`;
        partes.push(incluirNulo ? `(${condicao} OR ${coluna} IS NULL)` : condicao);
    };

    igual('t.periodo_letivo_id', recorte.periodoId);
    igual('t.campus_id', recorte.campusId);
    igual('a.dia_semana', recorte.diaSemana);
    listaDe('t.curso_id', recorte.cursosIds);
    listaDe('t.id', recorte.turmasIds);
    listaDe('a.local_id', recorte.locaisIds, {
        incluirNulo: recorte.incluirSemLocal !== false,
    });

    return partes.length > 0 ? ` AND ${partes.join(' AND ')}` : '';
};

/**
 * Aulas do recorte num dia da semana, uma linha por (aula, turma que cursa).
 * A ordem ja e a da exibicao: hora de inicio, curso, turma.
 *
 * @param {{periodoId:number, campusId:number, diaSemana:number, cursosIds?:number[],
 *          turmasIds?:number[], locaisIds?:number[], incluirSemLocal?:boolean}} recorte
 * @returns {Promise<Array<object>>}
 */
const listarAulasDoDia = async (recorte = {}) => {
    const parametros = [];
    const condicoes = montarFiltros(recorte, parametros);

    const resultado = await db.query(
        `SELECT a.id AS aula_id,
                a.dia_semana,
                a.modalidade,
                t.id AS turma_id,
                t.codigo AS turma_codigo,
                t.nome AS turma_nome,
                t.semestre_curricular,
                cu.id AS curso_id,
                cu.sigla AS curso_sigla,
                cu.nome AS curso_nome,
                d.id AS disciplina_id,
                d.nome AS disciplina_nome,
                p.id AS professor_id,
                p.nome AS professor_nome,
                l.id AS local_id,
                l.nome AS local_nome,
                h.hora_inicio,
                h.hora_fim,
                h.ordem AS horario_ordem
         ${ORIGEM} ${condicoes}
          ORDER BY h.hora_inicio, cu.sigla, t.codigo, d.nome, a.id`,
        parametros
    );

    return resultado.rows;
};

/**
 * Dias da semana (1..6) que tem ao menos uma aula no recorte. Usado para virar
 * o painel para o proximo dia letivo depois da ultima aula da noite, sem
 * inventar um dia vazio.
 *
 * @param {object} recorte mesmo formato de `listarAulasDoDia`, sem `diaSemana`
 * @returns {Promise<number[]>}
 */
const listarDiasComAula = async (recorte = {}) => {
    const parametros = [];
    const condicoes = montarFiltros({ ...recorte, diaSemana: undefined }, parametros);

    const resultado = await db.query(
        `SELECT DISTINCT a.dia_semana ${ORIGEM} ${condicoes} ORDER BY a.dia_semana`,
        parametros
    );

    return resultado.rows.map((linha) => Number(linha.dia_semana));
};

/** Periodo letivo corrente. Nunca vem da URL: uma TV fica anos no ar. */
const periodoAtual = async () => {
    const resultado = await db.query(
        `SELECT id, codigo
           FROM periodos_letivos
          WHERE ativo
          ORDER BY atual DESC, ano DESC, semestre DESC, codigo DESC
          LIMIT 1`
    );
    return resultado.rows[0] || null;
};

/** Campus ativos que tem turma publicada no periodo. */
const listarCampus = async ({ periodoId } = {}) => {
    const parametros = [periodoId];
    const resultado = await db.query(
        `SELECT DISTINCT ca.id, ca.nome, ca.sigla
           FROM turmas t
           JOIN campus ca ON ca.id = t.campus_id AND ca.ativo
          WHERE t.ativo AND NOT t.gerencial AND t.periodo_letivo_id = $1
          ORDER BY ca.nome`,
        parametros
    );
    return resultado.rows;
};

/** Cursos com turma publicada no campus. */
const listarCursos = async ({ periodoId, campusId } = {}) => {
    const resultado = await db.query(
        `SELECT DISTINCT cu.id, cu.nome, cu.sigla
           FROM turmas t
           JOIN cursos cu ON cu.id = t.curso_id AND cu.ativo
          WHERE t.ativo AND NOT t.gerencial
            AND t.periodo_letivo_id = $1 AND t.campus_id = $2
          ORDER BY cu.nome`,
        [periodoId, campusId]
    );
    return resultado.rows;
};

/** Turmas publicadas no campus, ja com o curso resolvido. */
const listarTurmas = async ({ periodoId, campusId } = {}) => {
    const resultado = await db.query(
        `SELECT t.id, t.codigo, t.nome, t.semestre_curricular, cu.sigla AS curso_sigla
           FROM turmas t
           JOIN cursos cu ON cu.id = t.curso_id AND cu.ativo
          WHERE t.ativo AND NOT t.gerencial
            AND t.periodo_letivo_id = $1 AND t.campus_id = $2
          ORDER BY cu.sigla, t.codigo`,
        [periodoId, campusId]
    );
    return resultado.rows;
};

/**
 * Locais ativos do campus. O ambiente virtual fica de fora: ele nao e um lugar
 * aonde alguem vai, e o painel de bloco existe para dizer aonde ir.
 */
const listarLocais = async ({ campusId } = {}) => {
    const resultado = await db.query(
        `SELECT id, nome, codigo, tipo
           FROM locais
          WHERE ativo AND campus_id = $1 AND tipo <> 'virtual'
          ORDER BY nome`,
        [campusId]
    );
    return resultado.rows;
};

module.exports = {
    listarAulasDoDia,
    listarDiasComAula,
    periodoAtual,
    listarCampus,
    listarCursos,
    listarTurmas,
    listarLocais,
};
