/**
 * Acesso a dados de `aulas`.
 *
 * Todo o SQL da grade horaria vive aqui: nenhum service monta consulta. Todas as
 * queries sao parametrizadas e toda funcao aceita um `executor` opcional (o
 * cliente de uma transacao); por padrao usa o pool compartilhado.
 *
 * Conflitos de professor e de local sao comparados pela FAIXA REAL de horario
 * (`hora_inicio`/`hora_fim`) e nao pelo `horario_turno_id`: o 5o horario do
 * Matutino e o 5o do Integral sao registros diferentes que ocupam o mesmo tempo
 * de relogio. Duas faixas se sobrepoem quando
 * `a.hora_inicio < b.hora_fim AND b.hora_inicio < a.hora_fim`.
 */
const db = require('../config/db');
const { TAMANHO_PADRAO } = require('../utils/paginacao');

/** Chave da trava consultiva que serializa gravacoes concorrentes na grade. */
const CHAVE_TRAVA_GRADE = 918273;

const COLUNAS = `
    a.id,
    a.turma_id,
    a.disciplina_id,
    a.professor_id,
    a.local_id,
    a.dia_semana,
    a.horario_turno_id,
    a.modalidade,
    a.observacao,
    a.ativo,
    a.criado_em,
    a.atualizado_em,
    d.nome AS disciplina_nome,
    d.codigo AS disciplina_codigo,
    d.ativo AS disciplina_ativa,
    p.nome AS professor_nome,
    p.ativo AS professor_ativo,
    l.nome AS local_nome,
    l.codigo AS local_codigo,
    l.tipo AS local_tipo,
    l.campus_id AS local_campus_id,
    l.ativo AS local_ativo,
    h.nome AS horario_nome,
    h.ordem AS horario_ordem,
    h.hora_inicio,
    h.hora_fim,
    h.ativo AS horario_ativo,
    h.turno_id AS horario_turno,
    t.nome AS turma_nome,
    t.codigo AS turma_codigo,
    t.curso_id,
    t.campus_id,
    t.turno_id,
    t.periodo_letivo_id,
    t.semestre_curricular,
    t.gerencial AS turma_gerencial,
    t.ativo AS turma_ativa,
    (SELECT COUNT(*)::int FROM aula_professores ap WHERE ap.aula_id = a.id) AS total_professores,
    (SELECT STRING_AGG(pr.nome, ', ' ORDER BY pr.nome)
       FROM aula_professores ap
       JOIN professores pr ON pr.id = ap.professor_id
      WHERE ap.aula_id = a.id
        AND ap.professor_id IS DISTINCT FROM a.professor_id) AS outros_professores,
    (SELECT COALESCE(
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'id', tt.id,
                        'codigo', tt.codigo,
                        'nome', tt.nome,
                        'semestre', tt.semestre_curricular
                    )
                    ORDER BY tt.semestre_curricular NULLS LAST, tt.codigo
                ),
                '[]'
            )
       FROM aula_turmas att
       JOIN turmas tt ON tt.id = att.turma_id
      WHERE att.aula_id = a.id) AS turmas_atendidas
`;

const JUNCOES = `
      FROM aulas a
      JOIN turmas t ON t.id = a.turma_id
      JOIN disciplinas d ON d.id = a.disciplina_id
      LEFT JOIN professores p ON p.id = a.professor_id
      LEFT JOIN locais l ON l.id = a.local_id
      LEFT JOIN horarios_turno h ON h.id = a.horario_turno_id
`;

const ORDENACAO =
    'ORDER BY a.dia_semana, h.ordem NULLS LAST, h.hora_inicio NULLS LAST, d.nome, a.id';

const inteiroOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : null;
};

/**
 * Trava consultiva de transacao que serializa as gravacoes da grade.
 *
 * Conflitos de professor e de local nao tem constraint no banco (dependem da
 * faixa real de horario, que atravessa turnos), entao duas transacoes
 * simultaneas poderiam validar e gravar aulas conflitantes. A trava e liberada
 * automaticamente no COMMIT/ROLLBACK.
 *
 * @param {{query: Function}} executor cliente DENTRO de uma transacao
 * @returns {Promise<void>}
 */
const travarGrade = async (executor) => {
    await executor.query('SELECT pg_advisory_xact_lock($1, $2)', [CHAVE_TRAVA_GRADE, 1]);
};

/**
 * Aulas de uma turma, com disciplina, professor, local e horario resolvidos.
 * @param {number} turmaId
 * @param {{incluirInativas?: boolean}} [opcoes]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listarPorTurma = async (turmaId, { incluirInativas = false } = {}, executor = db) => {
    const identificador = inteiroOuNulo(turmaId);
    if (identificador === null) return [];

    // `vw_aulas_das_turmas` traz tambem as aulas que a turma apenas ASSISTE:
    // a disciplina compartilhada fica registrada uma unica vez na turma
    // gerencial e aparece na grade de cada turma que a cursa. `propria`
    // distingue as duas situacoes — a turma que so assiste nao edita a aula.
    const resultado = await executor.query(
        `SELECT ${COLUNAS},
                v.propria
         ${JUNCOES}
          JOIN vw_aulas_das_turmas v ON v.aula_id = a.id
          WHERE v.turma_id = $1
            AND ($2::boolean OR a.ativo)
          ${ORDENACAO}`,
        [identificador, Boolean(incluirInativas)]
    );

    return resultado.rows;
};

/**
 * Reescreve quais turmas cursam uma aula.
 *
 * `null` em `turmasIds` significa "nao mexer" — e o caso de toda edicao que nao
 * envolve o vinculo. Lista vazia limpa o vinculo.
 *
 * @param {number} aulaId
 * @param {number[]|null} turmasIds
 * @param {{query: Function}} [executor]
 * @returns {Promise<void>}
 */
const definirTurmasAtendidas = async (aulaId, turmasIds, executor = db) => {
    const identificador = inteiroOuNulo(aulaId);
    if (identificador === null || turmasIds === null || turmasIds === undefined) return;

    await executor.query('DELETE FROM aula_turmas WHERE aula_id = $1', [identificador]);

    const lista = turmasIds.map(Number).filter((item) => Number.isFinite(item) && item > 0);
    if (lista.length === 0) return;

    await executor.query(
        `INSERT INTO aula_turmas (aula_id, turma_id)
         SELECT $1, t.id FROM turmas t WHERE t.id = ANY($2::int[])
         ON CONFLICT (aula_id, turma_id) DO NOTHING`,
        [identificador, lista]
    );
};

/**
 * Turmas que uma gerencial pode atender: as que estao ligadas a ela.
 * @param {number} turmaGerencialId
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, codigo:string, nome:string, semestre:number|null}>>}
 */
const turmasCandidatasDaGerencial = async (turmaGerencialId, executor = db) => {
    const identificador = inteiroOuNulo(turmaGerencialId);
    if (identificador === null) return [];

    // Candidatas = turmas regulares do mesmo curso, campus e periodo. A turma
    // gerencial e um recorte de ensalamento dentro desse conjunto, entao e
    // dali que sai quem pode passar a cursar a disciplina.
    const resultado = await executor.query(
        `SELECT c.id, c.codigo, c.nome, c.semestre_curricular AS semestre, c.ativo
           FROM turmas g
           JOIN turmas c
             ON c.periodo_letivo_id = g.periodo_letivo_id
            AND c.campus_id = g.campus_id
            AND c.curso_id = g.curso_id
            AND NOT c.gerencial
          WHERE g.id = $1
          ORDER BY c.semestre_curricular NULLS LAST, c.codigo`,
        [identificador]
    );
    return resultado.rows;
};

/**
 * Turmas atendidas pelas aulas de uma turma gerencial, com o semestre de cada
 * uma. Alimenta o seletor que recorta a grade da gerencial.
 * @param {number} turmaId turma gerencial
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, codigo:string, nome:string, semestre:number|null, aulas:number}>>}
 */
const turmasAtendidasPor = async (turmaId, executor = db) => {
    const identificador = inteiroOuNulo(turmaId);
    if (identificador === null) return [];

    const resultado = await executor.query(
        `SELECT t.id,
                t.codigo,
                t.nome,
                t.semestre_curricular AS semestre,
                COUNT(*)::int AS aulas
           FROM aula_turmas att
           JOIN aulas a ON a.id = att.aula_id AND a.ativo
           JOIN turmas t ON t.id = att.turma_id
          WHERE a.turma_id = $1
          GROUP BY t.id
          ORDER BY t.semestre_curricular NULLS LAST, t.codigo`,
        [identificador]
    );

    return resultado.rows;
};

/**
 * Aula detalhada pelo id.
 * @param {number} id
 * @param {{query: Function}} [executor]
 * @param {{bloquear?: boolean}} [opcoes] `bloquear` aplica FOR UPDATE na aula
 * @returns {Promise<object|null>}
 */
const buscarPorId = async (id, executor = db, { bloquear = false } = {}) => {
    const identificador = inteiroOuNulo(id);
    if (identificador === null) return null;

    const resultado = await executor.query(
        `SELECT ${COLUNAS}
         ${JUNCOES}
          WHERE a.id = $1
          ${bloquear ? 'FOR NO KEY UPDATE OF a' : ''}`,
        [identificador]
    );

    return resultado.rows[0] || null;
};

/**
 * Insere uma aula. Os campos sao listados um a um: nada vindo do corpo da
 * requisicao chega aqui sem passar pelo validador.
 * @param {{turmaId:number, disciplinaId:number, professorId?:number|null,
 *          localId?:number|null, diaSemana:number, horarioTurnoId?:number|null,
 *          modalidade?:string, observacao?:string|null, ativo?:boolean}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object>} linha crua de `aulas`
 */
const inserir = async (dados, executor = db) => {
    const resultado = await executor.query(
        `INSERT INTO aulas
            (turma_id, disciplina_id, professor_id, local_id, dia_semana,
             horario_turno_id, modalidade, observacao, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
            dados.turmaId,
            dados.disciplinaId,
            dados.professorId ?? null,
            dados.localId ?? null,
            dados.diaSemana,
            dados.horarioTurnoId ?? null,
            dados.modalidade || 'presencial',
            dados.observacao ?? null,
            dados.ativo === undefined ? true : Boolean(dados.ativo),
        ]
    );

    return resultado.rows[0];
};

/**
 * Atualiza todos os campos editaveis de uma aula.
 * @param {number} id
 * @param {object} dados mesmos campos de `inserir`
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>} linha crua atualizada ou null
 */
const atualizar = async (id, dados, executor = db) => {
    const resultado = await executor.query(
        `UPDATE aulas
            SET turma_id = $2,
                disciplina_id = $3,
                professor_id = $4,
                local_id = $5,
                dia_semana = $6,
                horario_turno_id = $7,
                modalidade = $8,
                observacao = $9,
                ativo = $10
          WHERE id = $1
          RETURNING *`,
        [
            id,
            dados.turmaId,
            dados.disciplinaId,
            dados.professorId ?? null,
            dados.localId ?? null,
            dados.diaSemana,
            dados.horarioTurnoId ?? null,
            dados.modalidade || 'presencial',
            dados.observacao ?? null,
            dados.ativo === undefined ? true : Boolean(dados.ativo),
        ]
    );

    return resultado.rows[0] || null;
};

/**
 * Grava apenas o local da aula. Usado pela alocacao em lote, que nao mexe em
 * mais nenhum campo.
 * @param {number} id
 * @param {number|null} localId
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const definirLocal = async (id, localId, executor = db) => {
    const resultado = await executor.query(
        'UPDATE aulas SET local_id = $2 WHERE id = $1 RETURNING *',
        [inteiroOuNulo(id), inteiroOuNulo(localId)]
    );
    return resultado.rows[0] || null;
};

/**
 * Liga/desliga uma aula preservando o historico.
 * @param {number} id
 * @param {boolean} ativo
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo, executor = db) => {
    const resultado = await executor.query(
        'UPDATE aulas SET ativo = $2 WHERE id = $1 RETURNING *',
        [id, Boolean(ativo)]
    );
    return resultado.rows[0] || null;
};

/**
 * Exclusao destrutiva de uma aula.
 * @param {number} id
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>} true quando removeu
 */
const excluir = async (id, executor = db) => {
    const resultado = await executor.query('DELETE FROM aulas WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * Monta o WHERE compartilhado por `listar`, `contar` e `pendencias`.
 * @param {object} filtros
 * @returns {{sql:string, parametros:any[]}}
 */
const montarFiltros = (filtros = {}) => {
    const condicoes = ['TRUE'];
    const parametros = [];

    const numerico = (valor, coluna) => {
        const numero = inteiroOuNulo(valor);
        if (numero === null) return;
        parametros.push(numero);
        condicoes.push(`${coluna} = $${parametros.length}`);
    };

    numerico(filtros.turmaId, 'a.turma_id');
    numerico(filtros.disciplinaId, 'a.disciplina_id');
    numerico(filtros.professorId, 'a.professor_id');
    numerico(filtros.localId, 'a.local_id');
    numerico(filtros.horarioTurnoId, 'a.horario_turno_id');
    numerico(filtros.diaSemana, 'a.dia_semana');
    numerico(filtros.cursoId, 't.curso_id');
    numerico(filtros.campusId, 't.campus_id');
    numerico(filtros.periodoLetivoId, 't.periodo_letivo_id');
    numerico(filtros.turnoId, 't.turno_id');

    if (filtros.modalidade) {
        parametros.push(String(filtros.modalidade));
        condicoes.push(`a.modalidade = $${parametros.length}`);
    }

    if (filtros.ativo === true || filtros.ativo === false) {
        parametros.push(filtros.ativo);
        condicoes.push(`a.ativo = $${parametros.length}`);
    }

    if (filtros.semHorario === true) condicoes.push('a.horario_turno_id IS NULL');
    if (filtros.semLocal === true) condicoes.push('a.local_id IS NULL');
    if (filtros.semProfessor === true) condicoes.push('a.professor_id IS NULL');

    if (Array.isArray(filtros.cursosIds)) {
        parametros.push(filtros.cursosIds.map(Number));
        condicoes.push(`t.curso_id = ANY($${parametros.length}::int[])`);
    }

    if (Array.isArray(filtros.campusIds)) {
        parametros.push(filtros.campusIds.map(Number));
        condicoes.push(`t.campus_id = ANY($${parametros.length}::int[])`);
    }

    const termo = typeof filtros.busca === 'string' ? filtros.busca.trim() : '';
    if (termo) {
        parametros.push(`%${termo}%`);
        const indice = parametros.length;
        condicoes.push(
            `(d.nome ILIKE $${indice} OR d.codigo ILIKE $${indice} OR p.nome ILIKE $${indice}
              OR l.nome ILIKE $${indice} OR t.nome ILIKE $${indice} OR t.codigo ILIKE $${indice})`
        );
    }

    return { sql: condicoes.join(' AND '), parametros };
};

/**
 * Listagem paginada de aulas com filtros.
 * @param {object} [filtros] ver `montarFiltros` + `pagina`/`porPagina`
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listar = async (filtros = {}, executor = db) => {
    const { sql, parametros } = montarFiltros(filtros);
    const porPagina = Math.max(inteiroOuNulo(filtros.porPagina) || TAMANHO_PADRAO, 1);
    const pagina = Math.max(inteiroOuNulo(filtros.pagina) || 1, 1);

    parametros.push(porPagina, (pagina - 1) * porPagina);

    const resultado = await executor.query(
        `SELECT ${COLUNAS}
         ${JUNCOES}
          WHERE ${sql}
          ${ORDENACAO}
          LIMIT $${parametros.length - 1} OFFSET $${parametros.length}`,
        parametros
    );

    return resultado.rows;
};

/**
 * Total de aulas para os mesmos filtros de `listar`.
 * @param {object} [filtros]
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const contar = async (filtros = {}, executor = db) => {
    const { sql, parametros } = montarFiltros(filtros);

    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total
         ${JUNCOES}
          WHERE ${sql}`,
        parametros
    );

    return resultado.rows[0].total;
};

/**
 * Aulas pendentes de preenchimento (sem horario e/ou sem local/professor).
 * @param {object} [filtros] filtros comuns + `incluirProfessor` (default false)
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const pendencias = async (filtros = {}, executor = db) => {
    const base = { ...filtros };
    delete base.semHorario;
    delete base.semLocal;
    delete base.semProfessor;
    if (base.ativo === undefined || base.ativo === null) base.ativo = true;

    const { sql, parametros } = montarFiltros(base);

    const faltas = ['a.horario_turno_id IS NULL', 'a.local_id IS NULL'];
    if (filtros.incluirProfessor === true) faltas.push('a.professor_id IS NULL');

    const limite = Math.max(inteiroOuNulo(filtros.limite) || 200, 1);
    parametros.push(limite);

    const resultado = await executor.query(
        `SELECT ${COLUNAS}
         ${JUNCOES}
          WHERE ${sql}
            AND (${faltas.join(' OR ')})
          ${ORDENACAO}
          LIMIT $${parametros.length}`,
        parametros
    );

    return resultado.rows;
};

/**
 * Contadores da grade de uma turma (apenas aulas ativas).
 * @param {number} turmaId
 * @param {{query: Function}} [executor]
 * @returns {Promise<{aulas:number, comLocal:number, semLocal:number,
 *                    semProfessor:number, semHorario:number}>}
 */
const contarPorTurma = async (turmaId, executor = db) => {
    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS aulas,
                COUNT(*) FILTER (WHERE a.local_id IS NOT NULL)::int AS "comLocal",
                COUNT(*) FILTER (WHERE a.local_id IS NULL)::int AS "semLocal",
                COUNT(*) FILTER (WHERE a.professor_id IS NULL)::int AS "semProfessor",
                COUNT(*) FILTER (WHERE a.horario_turno_id IS NULL)::int AS "semHorario"
           FROM aulas a
           JOIN vw_aulas_das_turmas v ON v.aula_id = a.id
          WHERE v.turma_id = $1 AND a.ativo`,
        [inteiroOuNulo(turmaId)]
    );

    return (
        resultado.rows[0] || { aulas: 0, comLocal: 0, semLocal: 0, semProfessor: 0, semHorario: 0 }
    );
};

/**
 * Colunas usadas nas consultas de conflito (o suficiente para montar a mensagem).
 */
const COLUNAS_CONFLITO = `
    a.id,
    a.turma_id,
    a.disciplina_id,
    a.dia_semana,
    a.modalidade,
    a.horario_turno_id,
    d.nome AS disciplina_nome,
    p.nome AS professor_nome,
    l.nome AS local_nome,
    l.tipo AS local_tipo,
    h.nome AS horario_nome,
    h.hora_inicio,
    h.hora_fim,
    t.nome AS turma_nome,
    t.codigo AS turma_codigo,
    t.curso_id,
    t.campus_id
`;

const JUNCOES_CONFLITO = `
      FROM aulas a
      JOIN turmas t ON t.id = a.turma_id
      JOIN disciplinas d ON d.id = a.disciplina_id
      JOIN horarios_turno h ON h.id = a.horario_turno_id
      LEFT JOIN professores p ON p.id = a.professor_id
      LEFT JOIN locais l ON l.id = a.local_id
`;

/**
 * Sobreposicao real entre a faixa da aula existente (`h`) e a faixa do horario
 * alvo (`alvo`). Nunca compara `horario_turno_id`: turnos diferentes podem ter
 * registros distintos ocupando exatamente o mesmo tempo de relogio.
 */
const SOBREPOE = 'h.hora_inicio < alvo.hora_fim AND alvo.hora_inicio < h.hora_fim';

/** `FOR NO KEY UPDATE OF a` so trava a aula; as tabelas de apoio ficam livres. */
const travaDeLeitura = (bloquear) => (bloquear ? 'FOR NO KEY UPDATE OF a' : '');

/**
 * Aulas ativas do professor que ocupam a mesma faixa de horario, em qualquer
 * turma, curso ou campus.
 * @param {{professorId:number, diaSemana:number, horarioTurnoId:number,
 *          ignorarAulaId?:number|null, bloquear?:boolean}} parametrosBusca
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const conflitantesDeProfessor = async (
    { professorId, diaSemana, horarioTurnoId, ignorarAulaId = null, bloquear = false },
    executor = db
) => {
    const professor = inteiroOuNulo(professorId);
    const horario = inteiroOuNulo(horarioTurnoId);
    const dia = inteiroOuNulo(diaSemana);
    if (professor === null || horario === null || dia === null) return [];

    const resultado = await executor.query(
        `SELECT ${COLUNAS_CONFLITO}
         ${JUNCOES_CONFLITO}
         CROSS JOIN horarios_turno alvo
          WHERE alvo.id = $1
            AND a.ativo
            AND a.professor_id = $2
            AND a.dia_semana = $3
            AND ${SOBREPOE}
            AND ($4::int IS NULL OR a.id <> $4)
          ORDER BY h.hora_inicio, a.id
          ${travaDeLeitura(bloquear)}`,
        [horario, professor, dia, inteiroOuNulo(ignorarAulaId)]
    );

    return resultado.rows;
};

/**
 * Aulas ativas que ocupam o mesmo local na mesma faixa de horario.
 * Locais do tipo `virtual` sao ignorados (varias turmas podem usa-los juntas).
 * @param {{localId:number, diaSemana:number, horarioTurnoId:number,
 *          ignorarAulaId?:number|null, bloquear?:boolean}} parametrosBusca
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const conflitantesDeLocal = async (
    { localId, diaSemana, horarioTurnoId, ignorarAulaId = null, bloquear = false },
    executor = db
) => {
    const local = inteiroOuNulo(localId);
    const horario = inteiroOuNulo(horarioTurnoId);
    const dia = inteiroOuNulo(diaSemana);
    if (local === null || horario === null || dia === null) return [];

    const resultado = await executor.query(
        `SELECT ${COLUNAS_CONFLITO}
         ${JUNCOES_CONFLITO}
         CROSS JOIN horarios_turno alvo
          WHERE alvo.id = $1
            AND a.ativo
            AND a.local_id = $2
            AND a.dia_semana = $3
            AND l.tipo <> 'virtual'
            AND ${SOBREPOE}
            AND ($4::int IS NULL OR a.id <> $4)
          ORDER BY h.hora_inicio, a.id
          ${travaDeLeitura(bloquear)}`,
        [horario, local, dia, inteiroOuNulo(ignorarAulaId)]
    );

    return resultado.rows;
};

/**
 * Aula ativa da mesma turma ocupando o mesmo dia e a mesma faixa de horario.
 *
 * A comparacao tambem e por faixa real: uma turma pode ter aulas apontando para
 * horarios de turnos distintos (turma de Integral usando horario do Matutino,
 * por exemplo) e o indice unico do banco nao pegaria esse caso.
 * @param {{turmaId:number, diaSemana:number, horarioTurnoId:number,
 *          ignorarAulaId?:number|null, bloquear?:boolean}} parametrosBusca
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const conflitanteDeTurma = async (
    { turmaId, diaSemana, horarioTurnoId, ignorarAulaId = null, bloquear = false },
    executor = db
) => {
    const turma = inteiroOuNulo(turmaId);
    const horario = inteiroOuNulo(horarioTurnoId);
    const dia = inteiroOuNulo(diaSemana);
    if (turma === null || horario === null || dia === null) return [];

    const resultado = await executor.query(
        `SELECT ${COLUNAS_CONFLITO}
         ${JUNCOES_CONFLITO}
         CROSS JOIN horarios_turno alvo
          WHERE alvo.id = $1
            AND a.ativo
            AND a.turma_id = $2
            AND a.dia_semana = $3
            AND ${SOBREPOE}
            AND ($4::int IS NULL OR a.id <> $4)
          ORDER BY h.hora_inicio, a.id
          ${travaDeLeitura(bloquear)}`,
        [horario, turma, dia, inteiroOuNulo(ignorarAulaId)]
    );

    return resultado.rows;
};

/**
 * Carrega, em uma unica ida ao banco, todos os registros referenciados por uma
 * aula (turma + curso + campus + turno, disciplina, professor, local e horario)
 * com as respectivas situacoes de ativo/inativo.
 *
 * Ids inexistentes voltam como colunas nulas, o que permite ao servico de
 * conflitos avisar "registro nao encontrado" sem uma segunda consulta.
 *
 * @param {{turmaId?:number, disciplinaId?:number, professorId?:number|null,
 *          localId?:number|null, horarioTurnoId?:number|null}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object>} linha unica com o contexto
 */
const contextoDaAula = async (dados = {}, executor = db) => {
    const resultado = await executor.query(
        `SELECT
                t.id AS turma_id,
                t.nome AS turma_nome,
                t.codigo AS turma_codigo,
                t.ativo AS turma_ativa,
                t.semestre_curricular,
                t.gerencial AS turma_gerencial,
                t.turno_id AS turma_turno_id,
                t.campus_id AS turma_campus_id,
                t.curso_id AS turma_curso_id,
                tn.nome AS turma_turno_nome,
                tn.ativo AS turma_turno_ativo,
                cu.nome AS turma_curso_nome,
                cu.ativo AS turma_curso_ativo,
                cp.nome AS turma_campus_nome,
                cp.ativo AS turma_campus_ativo,
                d.id AS disciplina_id,
                d.nome AS disciplina_nome,
                d.ativo AS disciplina_ativa,
                pr.id AS professor_id,
                pr.nome AS professor_nome,
                pr.ativo AS professor_ativo,
                lo.id AS local_id,
                lo.nome AS local_nome,
                lo.tipo AS local_tipo,
                lo.ativo AS local_ativo,
                lo.campus_id AS local_campus_id,
                lc.nome AS local_campus_nome,
                ho.id AS horario_id,
                ho.nome AS horario_nome,
                ho.ordem AS horario_ordem,
                ho.hora_inicio,
                ho.hora_fim,
                ho.ativo AS horario_ativo,
                ho.turno_id AS horario_turno_id,
                ht.nome AS horario_turno_nome,
                ht.ativo AS horario_turno_ativo
           FROM (SELECT $1::int AS turma_id,
                        $2::int AS disciplina_id,
                        $3::int AS professor_id,
                        $4::int AS local_id,
                        $5::int AS horario_id) par
           LEFT JOIN turmas t ON t.id = par.turma_id
           LEFT JOIN turnos tn ON tn.id = t.turno_id
           LEFT JOIN cursos cu ON cu.id = t.curso_id
           LEFT JOIN campus cp ON cp.id = t.campus_id
           LEFT JOIN disciplinas d ON d.id = par.disciplina_id
           LEFT JOIN professores pr ON pr.id = par.professor_id
           LEFT JOIN locais lo ON lo.id = par.local_id
           LEFT JOIN campus lc ON lc.id = lo.campus_id
           LEFT JOIN horarios_turno ho ON ho.id = par.horario_id
           LEFT JOIN turnos ht ON ht.id = ho.turno_id`,
        [
            inteiroOuNulo(dados.turmaId),
            inteiroOuNulo(dados.disciplinaId),
            inteiroOuNulo(dados.professorId),
            inteiroOuNulo(dados.localId),
            inteiroOuNulo(dados.horarioTurnoId),
        ]
    );

    return resultado.rows[0] || {};
};

/**
 * Cabecalho da turma usado pela matriz da grade.
 * @param {number} turmaId
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const resumoDaTurma = async (turmaId, executor = db) => {
    const identificador = inteiroOuNulo(turmaId);
    if (identificador === null) return null;

    const resultado = await executor.query(
        `SELECT t.id,
                t.nome,
                t.codigo,
                t.semestre_curricular,
                t.gerencial,
                t.turma_gerencial_id,
                t.ativo,
                t.curso_id,
                cu.nome AS curso_nome,
                cu.ativo AS curso_ativo,
                t.campus_id,
                cp.nome AS campus_nome,
                t.turno_id,
                tn.nome AS turno_nome,
                tn.slug AS turno_slug,
                t.periodo_letivo_id,
                pl.codigo AS periodo_codigo
           FROM turmas t
           JOIN cursos cu ON cu.id = t.curso_id
           JOIN campus cp ON cp.id = t.campus_id
           JOIN turnos tn ON tn.id = t.turno_id
           JOIN periodos_letivos pl ON pl.id = t.periodo_letivo_id
          WHERE t.id = $1`,
        [identificador]
    );

    return resultado.rows[0] || null;
};

module.exports = {
    travarGrade,
    listarPorTurma,
    turmasAtendidasPor,
    definirTurmasAtendidas,
    turmasCandidatasDaGerencial,
    buscarPorId,
    inserir,
    atualizar,
    definirAtivo,
    definirLocal,
    excluir,
    listar,
    contar,
    pendencias,
    contarPorTurma,
    conflitantesDeProfessor,
    conflitantesDeLocal,
    conflitanteDeTurma,
    contextoDaAula,
    resumoDaTurma,
};
