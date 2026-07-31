/**
 * Acesso a dados da importacao de grade (cubo do TOTVS).
 *
 * Todo o SQL da carga vive aqui, sempre parametrizado. O modulo nao decide
 * nada: quem resolve "este campus da planilha e aquele campus do banco" e o
 * `importacaoService`. Aqui so existem consultas e gravacoes.
 *
 * Duas caracteristicas guiam este arquivo:
 *
 *  - GRAVACAO EM LOTE. Uma carga mexe em ~1.500 aulas. Fazer uma ida ao banco
 *    por aula seria lento o suficiente para estourar o tempo da requisicao,
 *    entao as gravacoes usam `UNNEST` sobre arrays parametrizados: uma unica
 *    instrucao por tipo de registro, sem interpolar valor nenhum.
 *  - IDEMPOTENCIA. Toda aula importada carrega `origem_chave` (a identidade da
 *    aula no TOTVS). O `ON CONFLICT` sobre ela transforma a reimportacao em
 *    atualizacao, nunca em duplicata.
 *
 * Toda funcao aceita um `executor` (cliente de transacao); por padrao usa o
 * pool compartilhado.
 */
const db = require('../config/db');

const inteiroOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : null;
};

/**
 * Rotulo temporario dos periodos criados pela carga. A posicao definitiva so e
 * conhecida depois da renumeracao, que troca este rotulo por "Nº horário".
 */
const NOME_PROVISORIO = 'novo horário';

// ---------------------------------------------------------------------------
// Leitura das tabelas de apoio
// ---------------------------------------------------------------------------

/**
 * Campus cadastrados, com o codigo externo ja vinculado.
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, nome:string, sigla:string|null, codigo_externo:string|null, ativo:boolean}>>}
 */
const listarCampus = async (executor = db) => {
    const resultado = await executor.query(
        'SELECT id, nome, sigla, codigo_externo, ativo FROM campus ORDER BY nome'
    );
    return resultado.rows;
};

/**
 * Cursos cadastrados.
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, nome:string, sigla:string|null, codigo:string|null, ativo:boolean}>>}
 */
const listarCursos = async (executor = db) => {
    const resultado = await executor.query(
        'SELECT id, nome, sigla, codigo, ativo FROM cursos ORDER BY nome'
    );
    return resultado.rows;
};

/**
 * Turnos cadastrados, com os horarios de cada um.
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<object>>}
 */
const listarTurnosComHorarios = async (executor = db) => {
    const resultado = await executor.query(
        `SELECT t.id,
                t.nome,
                t.slug,
                t.ativo,
                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id', h.id,
                            'nome', h.nome,
                            'ordem', h.ordem,
                            'horaInicio', TO_CHAR(h.hora_inicio, 'HH24:MI'),
                            'horaFim', TO_CHAR(h.hora_fim, 'HH24:MI'),
                            'ativo', h.ativo
                        )
                        ORDER BY h.hora_inicio
                    ) FILTER (WHERE h.id IS NOT NULL),
                    '[]'
                ) AS horarios
           FROM turnos t
           LEFT JOIN horarios_turno h ON h.turno_id = t.id
          GROUP BY t.id
          ORDER BY t.ordem, t.nome`
    );
    return resultado.rows;
};

/**
 * Disciplinas com codigo, indexaveis pela chave externa.
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, nome:string, codigo:string|null, carga_horaria:number|null}>>}
 */
const listarDisciplinas = async (executor = db) => {
    const resultado = await executor.query(
        'SELECT id, nome, codigo, carga_horaria, ativo FROM disciplinas'
    );
    return resultado.rows;
};

/**
 * Professores cadastrados.
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, nome:string, matricula:string|null, ativo:boolean}>>}
 */
const listarProfessores = async (executor = db) => {
    const resultado = await executor.query('SELECT id, nome, matricula, ativo FROM professores');
    return resultado.rows;
};

/**
 * Periodos letivos cadastrados.
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<object>>}
 */
const listarPeriodos = async (executor = db) => {
    const resultado = await executor.query(
        `SELECT id, codigo, ano, semestre, atual, ativo
           FROM periodos_letivos
          ORDER BY ano DESC, semestre DESC`
    );
    return resultado.rows;
};

/**
 * Turmas de um periodo letivo, com o codigo em caixa alta para casamento.
 * @param {number} periodoLetivoId
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<object>>}
 */
const listarTurmasDoPeriodo = async (periodoLetivoId, executor = db) => {
    const resultado = await executor.query(
        `SELECT id, nome, UPPER(codigo) AS codigo, campus_id, curso_id, turno_id,
                semestre_curricular, gerencial, turma_gerencial_id, ativo
           FROM turmas
          WHERE periodo_letivo_id = $1 AND codigo IS NOT NULL`,
        [inteiroOuNulo(periodoLetivoId)]
    );
    return resultado.rows;
};

/**
 * Aulas ativas das turmas informadas, com a chave de origem e o slot ocupado.
 * Usada para decidir entre inserir, atualizar e recusar por conflito.
 * @param {number[]} turmasIds
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<object>>}
 */
const listarAulasDasTurmas = async (turmasIds = [], executor = db) => {
    if (turmasIds.length === 0) return [];

    const resultado = await executor.query(
        `SELECT id, turma_id, disciplina_id, dia_semana, horario_turno_id,
                origem, origem_chave, ativo
           FROM aulas
          WHERE turma_id = ANY($1::int[])`,
        [turmasIds.map(Number)]
    );
    return resultado.rows;
};

// ---------------------------------------------------------------------------
// Gravacao das entidades de apoio
// ---------------------------------------------------------------------------

/**
 * Cria campus em lote.
 * @param {Array<{nome:string, sigla:string|null, codigoExterno:string}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, codigo_externo:string}>>}
 */
const criarCampus = async (itens = [], executor = db) => {
    if (itens.length === 0) return [];

    const resultado = await executor.query(
        `INSERT INTO campus (nome, sigla, codigo_externo, ativo)
         SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::boolean[])
         RETURNING id, codigo_externo`,
        [
            itens.map((item) => item.nome),
            itens.map((item) => item.sigla),
            itens.map((item) => item.codigoExterno),
            itens.map(() => true),
        ]
    );
    return resultado.rows;
};

/**
 * Grava o codigo externo em campus ja existentes (casados por nome).
 * @param {Array<{id:number, codigoExterno:string}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>} quantidade atualizada
 */
const vincularCodigoExternoCampus = async (itens = [], executor = db) => {
    if (itens.length === 0) return 0;

    const resultado = await executor.query(
        `UPDATE campus c
            SET codigo_externo = v.codigo_externo
           FROM UNNEST($1::int[], $2::varchar[]) AS v(id, codigo_externo)
          WHERE c.id = v.id AND c.codigo_externo IS NULL`,
        [itens.map((item) => Number(item.id)), itens.map((item) => item.codigoExterno)]
    );
    return resultado.rowCount;
};

/**
 * Cria cursos em lote.
 * @param {Array<{nome:string, sigla:string|null, codigo:string|null}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, codigo:string|null, nome:string}>>}
 */
const criarCursos = async (itens = [], executor = db) => {
    if (itens.length === 0) return [];

    const resultado = await executor.query(
        `INSERT INTO cursos (nome, sigla, codigo, ativo)
         SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::boolean[])
         RETURNING id, codigo, nome`,
        [
            itens.map((item) => item.nome),
            itens.map((item) => item.sigla),
            itens.map((item) => item.codigo),
            itens.map(() => true),
        ]
    );
    return resultado.rows;
};

/**
 * Grava o codigo do curso em registros ja existentes (casados por nome).
 * @param {Array<{id:number, codigo:string, sigla:string|null}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const vincularCodigoCurso = async (itens = [], executor = db) => {
    if (itens.length === 0) return 0;

    const resultado = await executor.query(
        `UPDATE cursos c
            SET codigo = v.codigo,
                sigla = COALESCE(c.sigla, v.sigla)
           FROM UNNEST($1::int[], $2::varchar[], $3::varchar[]) AS v(id, codigo, sigla)
          WHERE c.id = v.id AND c.codigo IS NULL`,
        [
            itens.map((item) => Number(item.id)),
            itens.map((item) => item.codigo),
            itens.map((item) => item.sigla),
        ]
    );
    return resultado.rowCount;
};

/**
 * Garante os pares curso/campus usados pelas turmas da carga.
 * @param {Array<{cursoId:number, campusId:number}>} pares
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>} quantidade criada
 */
const garantirCursoCampus = async (pares = [], executor = db) => {
    if (pares.length === 0) return 0;

    const resultado = await executor.query(
        `INSERT INTO curso_campus (curso_id, campus_id)
         SELECT * FROM UNNEST($1::int[], $2::int[])
         ON CONFLICT (curso_id, campus_id) DO NOTHING`,
        [pares.map((par) => Number(par.cursoId)), pares.map((par) => Number(par.campusId))]
    );
    return resultado.rowCount;
};

/**
 * Cria disciplinas em lote.
 * @param {Array<{nome:string, codigo:string|null, cargaHoraria:number|null}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, codigo:string|null, nome:string}>>}
 */
const criarDisciplinas = async (itens = [], executor = db) => {
    if (itens.length === 0) return [];

    const resultado = await executor.query(
        `INSERT INTO disciplinas (nome, codigo, carga_horaria, ativo)
         SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::int[], $4::boolean[])
         RETURNING id, codigo, nome`,
        [
            itens.map((item) => item.nome),
            itens.map((item) => item.codigo),
            itens.map((item) => item.cargaHoraria),
            itens.map(() => true),
        ]
    );
    return resultado.rows;
};

/**
 * Atualiza nome e carga horaria de disciplinas ja cadastradas.
 * @param {Array<{id:number, nome:string, cargaHoraria:number|null}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const atualizarDisciplinas = async (itens = [], executor = db) => {
    if (itens.length === 0) return 0;

    const resultado = await executor.query(
        `UPDATE disciplinas d
            SET nome = v.nome,
                carga_horaria = COALESCE(v.carga_horaria, d.carga_horaria)
           FROM UNNEST($1::int[], $2::varchar[], $3::int[]) AS v(id, nome, carga_horaria)
          WHERE d.id = v.id
            AND (d.nome IS DISTINCT FROM v.nome
                 OR d.carga_horaria IS DISTINCT FROM COALESCE(v.carga_horaria, d.carga_horaria))`,
        [
            itens.map((item) => Number(item.id)),
            itens.map((item) => item.nome),
            itens.map((item) => item.cargaHoraria),
        ]
    );
    return resultado.rowCount;
};

/**
 * Garante a matriz curricular (curso x disciplina) observada na planilha.
 * @param {Array<{cursoId:number, disciplinaId:number}>} pares
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const garantirCursoDisciplinas = async (pares = [], executor = db) => {
    if (pares.length === 0) return 0;

    const resultado = await executor.query(
        `INSERT INTO curso_disciplinas (curso_id, disciplina_id, ativo)
         SELECT u.curso_id, u.disciplina_id, TRUE
           FROM UNNEST($1::int[], $2::int[]) AS u(curso_id, disciplina_id)
         ON CONFLICT (curso_id, disciplina_id) DO NOTHING`,
        [pares.map((par) => Number(par.cursoId)), pares.map((par) => Number(par.disciplinaId))]
    );
    return resultado.rowCount;
};

/**
 * Cria professores em lote.
 * @param {Array<{nome:string, matricula:string}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, matricula:string|null}>>}
 */
const criarProfessores = async (itens = [], executor = db) => {
    if (itens.length === 0) return [];

    const resultado = await executor.query(
        `INSERT INTO professores (nome, matricula, ativo)
         SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::boolean[])
         RETURNING id, matricula`,
        [itens.map((item) => item.nome), itens.map((item) => item.matricula), itens.map(() => true)]
    );
    return resultado.rows;
};

/**
 * Grava a matricula em professores ja cadastrados (casados por nome).
 * @param {Array<{id:number, matricula:string}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const vincularMatriculaProfessor = async (itens = [], executor = db) => {
    if (itens.length === 0) return 0;

    const resultado = await executor.query(
        `UPDATE professores p
            SET matricula = v.matricula
           FROM UNNEST($1::int[], $2::varchar[]) AS v(id, matricula)
          WHERE p.id = v.id AND p.matricula IS NULL`,
        [itens.map((item) => Number(item.id)), itens.map((item) => item.matricula)]
    );
    return resultado.rowCount;
};

/**
 * Cria um periodo letivo. Nunca marca como atual: essa escolha e do operador.
 * @param {{codigo:string, ano:number, semestre:number, dataInicio:Date|null, dataFim:Date|null}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object>}
 */
const criarPeriodo = async (dados, executor = db) => {
    const resultado = await executor.query(
        `INSERT INTO periodos_letivos (codigo, ano, semestre, data_inicio, data_fim, atual, ativo)
         VALUES ($1, $2, $3, $4, $5, FALSE, TRUE)
         ON CONFLICT (codigo) DO UPDATE
            SET data_inicio = COALESCE(periodos_letivos.data_inicio, EXCLUDED.data_inicio),
                data_fim = COALESCE(periodos_letivos.data_fim, EXCLUDED.data_fim)
         RETURNING id, codigo, ano, semestre, atual, ativo`,
        [dados.codigo, dados.ano, dados.semestre, dados.dataInicio, dados.dataFim]
    );
    return resultado.rows[0];
};

// ---------------------------------------------------------------------------
// Horarios do turno
// ---------------------------------------------------------------------------

/**
 * Cria horarios de turno em lote. O CHECK de 50 minutos e o gatilho de
 * sobreposicao continuam valendo: qualquer faixa fora do padrao e recusada
 * pelo banco, e nao aqui.
 * @param {Array<{turnoId:number, nome:string, ordem:number, horaInicio:string, horaFim:string}>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, turno_id:number, hora_inicio:string, hora_fim:string}>>}
 */
const criarHorarios = async (itens = [], executor = db) => {
    if (itens.length === 0) return [];

    const criados = [];

    // Uma insercao por vez: o gatilho de sobreposicao avalia linha a linha e a
    // mensagem de erro precisa apontar qual faixa foi recusada.
    for (const item of itens) {
        const resultado = await executor.query(
            `INSERT INTO horarios_turno (turno_id, nome, ordem, hora_inicio, hora_fim, ativo)
             VALUES ($1, $2, $3, $4::time, $5::time, TRUE)
             RETURNING id, turno_id, TO_CHAR(hora_inicio, 'HH24:MI') AS hora_inicio,
                       TO_CHAR(hora_fim, 'HH24:MI') AS hora_fim, ordem`,
            [item.turnoId, item.nome, item.ordem, item.horaInicio, item.horaFim]
        );
        criados.push(resultado.rows[0]);
    }

    return criados;
};

/**
 * Renumera os horarios de um turno na ordem do relogio.
 *
 * Necessario depois de acrescentar faixas no meio do turno: a grade e desenhada
 * por `ordem`, entao um periodo novo inserido antes dos existentes precisa
 * assumir a posicao correta. O deslocamento intermediario evita colidir com o
 * indice unico (turno_id, ordem) durante a atualizacao.
 *
 * O nome so e reescrito quando segue o padrao "Nº horário" ou quando ainda esta
 * com o rotulo provisorio da criacao; nome personalizado pelo operador nao e
 * tocado.
 *
 * @param {number} turnoId
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>} quantidade reposicionada
 */
const renumerarHorarios = async (turnoId, executor = db) => {
    const id = inteiroOuNulo(turnoId);
    if (id === null) return 0;

    await executor.query(
        'UPDATE horarios_turno SET ordem = ordem + 1000 WHERE turno_id = $1 AND ordem < 1000',
        [id]
    );

    const resultado = await executor.query(
        `UPDATE horarios_turno h
            SET ordem = nova.posicao,
                nome = CASE
                    WHEN h.nome ~ '^[0-9]+º horário$' OR h.nome = $2
                        THEN nova.posicao || 'º horário'
                    ELSE h.nome
                END
           FROM (
               SELECT id, ROW_NUMBER() OVER (ORDER BY hora_inicio, hora_fim) AS posicao
                 FROM horarios_turno
                WHERE turno_id = $1
           ) AS nova
          WHERE h.id = nova.id`,
        [id, NOME_PROVISORIO]
    );

    return resultado.rowCount;
};

// ---------------------------------------------------------------------------
// Turmas
// ---------------------------------------------------------------------------

/**
 * Cria turmas em lote.
 * @param {Array<object>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, codigo:string, campus_id:number}>>}
 */
const criarTurmas = async (itens = [], executor = db) => {
    if (itens.length === 0) return [];

    const resultado = await executor.query(
        `INSERT INTO turmas
            (nome, codigo, periodo_letivo_id, campus_id, curso_id, semestre_curricular,
             turno_id, gerencial, ativo)
         SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::int[], $4::int[], $5::int[],
                              $6::int[], $7::int[], $8::boolean[], $9::boolean[])
         RETURNING id, UPPER(codigo) AS codigo, campus_id`,
        [
            itens.map((item) => item.nome),
            itens.map((item) => item.codigo),
            itens.map((item) => item.periodoLetivoId),
            itens.map((item) => item.campusId),
            itens.map((item) => item.cursoId),
            itens.map((item) => item.semestreCurricular),
            itens.map((item) => item.turnoId),
            itens.map((item) => item.gerencial),
            itens.map(() => true),
        ]
    );
    return resultado.rows;
};

/**
 * Atualiza turmas ja cadastradas com o que a planilha informa.
 *
 * Deliberadamente NAO mexe em `ativo`: desativar turma e decisao do operador.
 * @param {Array<object>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const atualizarTurmas = async (itens = [], executor = db) => {
    if (itens.length === 0) return 0;

    const resultado = await executor.query(
        `UPDATE turmas t
            SET nome = v.nome,
                curso_id = v.curso_id,
                turno_id = v.turno_id,
                semestre_curricular = v.semestre_curricular,
                gerencial = v.gerencial
           FROM UNNEST($1::int[], $2::varchar[], $3::int[], $4::int[], $5::int[], $6::boolean[])
                AS v(id, nome, curso_id, turno_id, semestre_curricular, gerencial)
          WHERE t.id = v.id
            AND (t.nome IS DISTINCT FROM v.nome
                 OR t.curso_id IS DISTINCT FROM v.curso_id
                 OR t.turno_id IS DISTINCT FROM v.turno_id
                 OR t.semestre_curricular IS DISTINCT FROM v.semestre_curricular
                 OR t.gerencial IS DISTINCT FROM v.gerencial)`,
        [
            itens.map((item) => Number(item.id)),
            itens.map((item) => item.nome),
            itens.map((item) => item.cursoId),
            itens.map((item) => item.turnoId),
            itens.map((item) => item.semestreCurricular),
            itens.map((item) => item.gerencial),
        ]
    );
    return resultado.rowCount;
};

/**
 * Liga cada turma regular a turma gerencial que oferta suas disciplinas
 * compartilhadas.
 * @param {Array<{turmaId:number, gerencialId:number}>} vinculos
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const vincularTurmasGerenciais = async (vinculos = [], executor = db) => {
    if (vinculos.length === 0) return 0;

    const resultado = await executor.query(
        `UPDATE turmas t
            SET turma_gerencial_id = v.gerencial_id
           FROM UNNEST($1::int[], $2::int[]) AS v(turma_id, gerencial_id)
          WHERE t.id = v.turma_id
            AND t.id <> v.gerencial_id
            AND t.turma_gerencial_id IS DISTINCT FROM v.gerencial_id`,
        [
            vinculos.map((item) => Number(item.turmaId)),
            vinculos.map((item) => Number(item.gerencialId)),
        ]
    );
    return resultado.rowCount;
};

// ---------------------------------------------------------------------------
// Aulas
// ---------------------------------------------------------------------------

/**
 * Insere ou atualiza aulas importadas, identificando cada uma por `origem_chave`.
 *
 * `xmax = 0` distingue, dentro da transacao, a linha recem-inserida da que ja
 * existia e foi atualizada — e como o relatorio sabe quantas aulas sao novas.
 *
 * @param {Array<object>} itens
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<{id:number, origem_chave:string, inserida:boolean}>>}
 */
const gravarAulas = async (itens = [], executor = db) => {
    if (itens.length === 0) return [];

    const resultado = await executor.query(
        `INSERT INTO aulas
            (turma_id, disciplina_id, professor_id, local_id, dia_semana, horario_turno_id,
             modalidade, ativo, origem, origem_chave)
         SELECT u.turma_id, u.disciplina_id, u.professor_id, NULL, u.dia_semana,
                u.horario_turno_id, u.modalidade, TRUE, 'totvs', u.origem_chave
           FROM UNNEST($1::int[], $2::int[], $3::int[], $4::int[], $5::int[],
                       $6::varchar[], $7::varchar[])
                AS u(turma_id, disciplina_id, professor_id, dia_semana, horario_turno_id,
                     modalidade, origem_chave)
         ON CONFLICT (origem, origem_chave) WHERE origem_chave IS NOT NULL
         DO UPDATE SET
                turma_id = EXCLUDED.turma_id,
                disciplina_id = EXCLUDED.disciplina_id,
                professor_id = EXCLUDED.professor_id,
                dia_semana = EXCLUDED.dia_semana,
                horario_turno_id = EXCLUDED.horario_turno_id,
                modalidade = EXCLUDED.modalidade,
                ativo = TRUE
         RETURNING id, origem_chave, (xmax = 0) AS inserida`,
        [
            itens.map((item) => item.turmaId),
            itens.map((item) => item.disciplinaId),
            itens.map((item) => item.professorId),
            itens.map((item) => item.diaSemana),
            itens.map((item) => item.horarioTurnoId),
            itens.map((item) => item.modalidade),
            itens.map((item) => item.origemChave),
        ]
    );
    return resultado.rows;
};

/**
 * Substitui a equipe de professores das aulas informadas.
 * @param {number[]} aulasIds aulas cuja equipe sera reescrita
 * @param {Array<{aulaId:number, professorId:number, papel:string}>} vinculos
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>} vinculos gravados
 */
const substituirProfessoresDasAulas = async (aulasIds = [], vinculos = [], executor = db) => {
    if (aulasIds.length === 0) return 0;

    await executor.query('DELETE FROM aula_professores WHERE aula_id = ANY($1::int[])', [
        aulasIds.map(Number),
    ]);

    if (vinculos.length === 0) return 0;

    const resultado = await executor.query(
        `INSERT INTO aula_professores (aula_id, professor_id, papel)
         SELECT * FROM UNNEST($1::int[], $2::int[], $3::varchar[])
         ON CONFLICT (aula_id, professor_id) DO NOTHING`,
        [
            vinculos.map((item) => Number(item.aulaId)),
            vinculos.map((item) => Number(item.professorId)),
            vinculos.map((item) => item.papel),
        ]
    );
    return resultado.rowCount;
};

/**
 * Substitui as turmas que assistem cada aula.
 *
 * E o que faz a disciplina compartilhada aparecer na grade do semestre certo
 * sem duplicar a aula: um registro de aula, varias turmas enxergando.
 *
 * @param {number[]} aulasIds aulas cujo vinculo sera reescrito
 * @param {Array<{aulaId:number, turmaId:number}>} vinculos
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>} vinculos gravados
 */
const substituirTurmasDasAulas = async (aulasIds = [], vinculos = [], executor = db) => {
    if (aulasIds.length === 0) return 0;

    await executor.query('DELETE FROM aula_turmas WHERE aula_id = ANY($1::int[])', [
        aulasIds.map(Number),
    ]);

    if (vinculos.length === 0) return 0;

    const resultado = await executor.query(
        `INSERT INTO aula_turmas (aula_id, turma_id)
         SELECT * FROM UNNEST($1::int[], $2::int[])
         ON CONFLICT (aula_id, turma_id) DO NOTHING`,
        [vinculos.map((item) => Number(item.aulaId)), vinculos.map((item) => Number(item.turmaId))]
    );
    return resultado.rowCount;
};

/**
 * Inativa aulas importadas que sumiram da planilha.
 *
 * O alcance e restrito as turmas presentes no arquivo: uma carga parcial (um
 * curso, um campus) nunca desliga a grade de quem nao veio nela. Preserva o
 * historico — nada e apagado.
 *
 * @param {number[]} turmasIds turmas presentes na carga
 * @param {string[]} chavesPresentes chaves de origem que vieram na carga
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>} quantidade inativada
 */
const inativarAulasAusentes = async (turmasIds = [], chavesPresentes = [], executor = db) => {
    if (turmasIds.length === 0) return 0;

    const resultado = await executor.query(
        `UPDATE aulas
            SET ativo = FALSE
          WHERE origem = 'totvs'
            AND ativo
            AND turma_id = ANY($1::int[])
            AND NOT (origem_chave = ANY($2::varchar[]))`,
        [turmasIds.map(Number), chavesPresentes.length > 0 ? chavesPresentes : ['']]
    );
    return resultado.rowCount;
};

// ---------------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------------

/**
 * Registra a carga concluida.
 * @param {{arquivo:string, periodoLetivoId:number|null, usuarioId:number|null,
 *          linhasLidas:number, linhasConsideradas:number, resumo:object, avisos:object[]}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object>}
 */
const registrarImportacao = async (dados, executor = db) => {
    const resultado = await executor.query(
        `INSERT INTO importacoes
            (origem, arquivo, periodo_letivo_id, usuario_id, linhas_lidas,
             linhas_consideradas, resumo, avisos)
         VALUES ('totvs', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         RETURNING id, criado_em`,
        [
            dados.arquivo,
            inteiroOuNulo(dados.periodoLetivoId),
            inteiroOuNulo(dados.usuarioId),
            dados.linhasLidas || 0,
            dados.linhasConsideradas || 0,
            JSON.stringify(dados.resumo || {}),
            JSON.stringify(dados.avisos || []),
        ]
    );
    return resultado.rows[0];
};

/**
 * Ultimas cargas realizadas, com quem executou e em qual periodo.
 * @param {number} [limite=10]
 * @param {{query: Function}} [executor]
 * @returns {Promise<Array<object>>}
 */
const listarImportacoes = async (limite = 10, executor = db) => {
    const resultado = await executor.query(
        `SELECT i.id,
                i.arquivo,
                i.linhas_lidas,
                i.linhas_consideradas,
                i.resumo,
                i.avisos,
                i.criado_em,
                u.nome AS usuario_nome,
                pl.codigo AS periodo_codigo
           FROM importacoes i
           LEFT JOIN usuarios u ON u.id = i.usuario_id
           LEFT JOIN periodos_letivos pl ON pl.id = i.periodo_letivo_id
          ORDER BY i.criado_em DESC
          LIMIT $1`,
        [Math.max(inteiroOuNulo(limite) || 10, 1)]
    );
    return resultado.rows;
};

module.exports = {
    NOME_PROVISORIO,
    listarCampus,
    listarCursos,
    listarTurnosComHorarios,
    listarDisciplinas,
    listarProfessores,
    listarPeriodos,
    listarTurmasDoPeriodo,
    listarAulasDasTurmas,
    criarCampus,
    vincularCodigoExternoCampus,
    criarCursos,
    vincularCodigoCurso,
    garantirCursoCampus,
    criarDisciplinas,
    atualizarDisciplinas,
    garantirCursoDisciplinas,
    criarProfessores,
    vincularMatriculaProfessor,
    criarPeriodo,
    criarHorarios,
    renumerarHorarios,
    criarTurmas,
    atualizarTurmas,
    vincularTurmasGerenciais,
    gravarAulas,
    substituirProfessoresDasAulas,
    substituirTurmasDasAulas,
    inativarAulasAusentes,
    registrarImportacao,
    listarImportacoes,
};
