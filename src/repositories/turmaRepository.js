/**
 * Acesso a dados de `turmas`.
 *
 * Todo o SQL de turmas fica aqui. As regras de negocio (escopo do usuario,
 * coerencia curso x campus, bloqueio de exclusao com aulas) sao aplicadas em
 * `services/turmaService.js`; este modulo apenas executa consultas SEMPRE
 * parametrizadas (nunca interpola valores) e propaga os erros do PostgreSQL.
 *
 * Toda funcao aceita um `executor` opcional (cliente de transacao); por padrao
 * usa o pool compartilhado.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

const COLUNAS = `
    t.id,
    t.nome,
    t.codigo,
    t.periodo_letivo_id,
    t.campus_id,
    t.curso_id,
    t.semestre_curricular,
    t.turno_id,
    t.gerencial,
    t.turma_gerencial_id,
    t.ativo,
    t.criado_em,
    t.atualizado_em
`;

/** Colunas descritivas dos vinculos, usadas em listagens e no detalhe. */
const COLUNAS_VINCULOS = `
    p.codigo AS periodo_codigo,
    p.ano AS periodo_ano,
    p.semestre AS periodo_semestre,
    p.atual AS periodo_atual,
    ca.nome AS campus_nome,
    ca.sigla AS campus_sigla,
    c.nome AS curso_nome,
    c.sigla AS curso_sigla,
    tu.nome AS turno_nome,
    tu.slug AS turno_slug
`;

const JUNCOES = `
      FROM turmas t
      JOIN periodos_letivos p ON p.id = t.periodo_letivo_id
      JOIN campus ca ON ca.id = t.campus_id
      JOIN cursos c ON c.id = t.curso_id
      JOIN turnos tu ON tu.id = t.turno_id
`;

/** Total de aulas (ativas e inativas) da turma. */
/**
 * Turmas que a gerencial atende, na ordem de semestre. Alimenta a exibicao
 * "GPDIRM (DIR01M1 | DIR02M1 | ...)" da listagem.
 */
const GRUPO_DA_TURMA = `
    (SELECT COALESCE(
                JSON_AGG(
                    JSON_BUILD_OBJECT('id', g.id, 'codigo', g.codigo, 'semestre', g.semestre_curricular)
                    ORDER BY g.semestre_curricular NULLS LAST, g.codigo
                ),
                '[]'
            )
       FROM (SELECT DISTINCT att.turma_id
               FROM aulas a
               JOIN aula_turmas att ON att.aula_id = a.id
              WHERE a.turma_id = t.id) AS membros
       JOIN turmas g ON g.id = membros.turma_id) AS grupo
`;

/**
 * Aulas da turma, incluindo as que ela apenas assiste (disciplina compartilhada
 * registrada na turma gerencial). E o mesmo total que a grade exibe.
 */
const TOTAL_AULAS = `
    (SELECT COUNT(*)::int FROM vw_aulas_das_turmas v
      WHERE v.turma_id = t.id) AS total_aulas,
    (SELECT COUNT(*)::int FROM vw_aulas_das_turmas v
      JOIN aulas a ON a.id = v.aula_id
     WHERE v.turma_id = t.id AND a.ativo) AS total_aulas_ativas
`;

const ORDENACAO = 'ORDER BY p.ano DESC, p.semestre DESC, c.nome, t.semestre_curricular, t.nome';

const inteiroOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : null;
};

/**
 * Monta o WHERE compartilhado por `listar` e `contar`.
 *
 * `filtros.escopo` e uma funcao `(alias, indiceInicial) => {sql, parametros}`
 * (tipicamente `escopoService.filtroTurmas`), aplicada como primeiro fragmento
 * para que a numeracao dos placeholders continue coerente.
 *
 * @param {{escopo?:Function, busca?:string, periodoLetivoId?:number,
 *          campusId?:number, cursoId?:number, turnoId?:number,
 *          semestreCurricular?:number, ativo?:boolean|null}} [filtros]
 * @returns {import('../utils/consulta').ConstrutorFiltro}
 */
const montarFiltro = (filtros = {}) => {
    const filtro = novoFiltro();

    if (typeof filtros.escopo === 'function') {
        const escopo = filtros.escopo('t', filtro.proximoIndice) || {};
        filtro.fragmento(escopo.sql, escopo.parametros || []);
    }

    // Recorte padrao da listagem: turmas em que se monta grade. Ficam de fora as
    // que so recebem disciplina de uma gerencial e nao tem nenhuma aula
    // propria — a grade delas e montada na gerencial, nao aqui. Uma turma
    // integrada que TAMBEM tem aula propria continua aparecendo.
    if (filtros.exibicao === 'grade') {
        filtro.adicionar(
            `(t.gerencial
              OR EXISTS (SELECT 1 FROM aulas a WHERE a.turma_id = t.id)
              OR NOT EXISTS (SELECT 1 FROM aula_turmas att WHERE att.turma_id = t.id))`
        );
    }

    filtro.busca(['t.nome', 't.codigo'], filtros.busca);
    filtro.igual('t.periodo_letivo_id', filtros.periodoLetivoId);
    filtro.igual('t.campus_id', filtros.campusId);
    filtro.igual('t.curso_id', filtros.cursoId);
    filtro.igual('t.turno_id', filtros.turnoId);
    filtro.igual('t.semestre_curricular', filtros.semestreCurricular);
    filtro.booleano('t.ativo', filtros.ativo);

    return filtro;
};

/**
 * Listagem paginada com os nomes dos vinculos e a contagem de aulas.
 * @param {object} [filtros] mesmos filtros de `montarFiltro` + `limite`/`offset`
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listar = async (filtros = {}, executor = db) => {
    const filtro = montarFiltro(filtros);
    const parametros = [...filtro.parametros];

    const indiceLimite = filtro.proximoIndice;
    const indiceOffset = indiceLimite + 1;
    parametros.push(Math.max(inteiroOuNulo(filtros.limite) || 20, 1));
    parametros.push(Math.max(inteiroOuNulo(filtros.offset) || 0, 0));

    const resultado = await executor.query(
        `SELECT ${COLUNAS},
                ${COLUNAS_VINCULOS},
                ${TOTAL_AULAS},
                ${GRUPO_DA_TURMA}
        ${JUNCOES}
         ${filtro.where}
         ${ORDENACAO}
         LIMIT $${indiceLimite} OFFSET $${indiceOffset}`,
        parametros
    );

    return resultado.rows;
};

/**
 * Total de registros para os mesmos filtros de `listar`.
 * @param {object} [filtros]
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const contar = async (filtros = {}, executor = db) => {
    const filtro = montarFiltro(filtros);

    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total ${JUNCOES} ${filtro.where}`,
        filtro.parametros
    );

    return resultado.rows[0].total;
};

/**
 * Quantas turmas o recorte padrao esconde: as que apenas recebem disciplina de
 * uma gerencial. A listagem informa o numero para que ninguem ache que sumiram.
 * @param {object} [filtros] mesmos filtros de `listar`, sem `exibicao`
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const contarIntegradas = async (filtros = {}, executor = db) => {
    const filtro = montarFiltro({ ...filtros, exibicao: null });

    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total
         ${JUNCOES}
         ${filtro.where}
         ${filtro.where ? 'AND' : 'WHERE'} NOT t.gerencial
           AND EXISTS (SELECT 1 FROM aula_turmas att WHERE att.turma_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM aulas a WHERE a.turma_id = t.id)`,
        filtro.parametros
    );

    return resultado.rows[0].total;
};

/**
 * Busca uma turma pelo id, ja com os nomes dos vinculos e a contagem de aulas.
 * @param {number} id
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const buscarPorId = async (id, executor = db) => {
    const identificador = inteiroOuNulo(id);
    if (identificador === null) return null;

    const resultado = await executor.query(
        `SELECT ${COLUNAS},
                ${COLUNAS_VINCULOS},
                ${TOTAL_AULAS},
                ${GRUPO_DA_TURMA}
        ${JUNCOES}
         WHERE t.id = $1`,
        [identificador]
    );

    return resultado.rows[0] || null;
};

/**
 * Insere uma turma.
 * @param {{nome:string, codigo:string|null, periodoLetivoId:number, campusId:number,
 *          cursoId:number, semestreCurricular:number, turnoId:number, ativo?:boolean}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object>} linha inserida
 */
const inserir = async (dados, executor = db) => {
    const resultado = await executor.query(
        `INSERT INTO turmas
            (nome, codigo, periodo_letivo_id, campus_id, curso_id, semestre_curricular,
             turno_id, gerencial, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUNAS.replace(/t\./g, '')}`,
        [
            dados.nome,
            dados.codigo,
            dados.periodoLetivoId,
            dados.campusId,
            dados.cursoId,
            dados.semestreCurricular ?? null,
            dados.turnoId,
            Boolean(dados.gerencial),
            dados.ativo === undefined ? true : Boolean(dados.ativo),
        ]
    );
    return resultado.rows[0];
};

/**
 * Atualiza uma turma por completo (campo a campo, sem spread do corpo).
 * @param {number} id
 * @param {object} dados mesmos campos de `inserir`
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>} linha atualizada ou null quando o id nao existe
 */
const atualizar = async (id, dados, executor = db) => {
    const resultado = await executor.query(
        `UPDATE turmas
            SET nome = $2,
                codigo = $3,
                periodo_letivo_id = $4,
                campus_id = $5,
                curso_id = $6,
                semestre_curricular = $7,
                turno_id = $8,
                gerencial = $9,
                ativo = $10
          WHERE id = $1
          RETURNING ${COLUNAS.replace(/t\./g, '')}`,
        [
            id,
            dados.nome,
            dados.codigo,
            dados.periodoLetivoId,
            dados.campusId,
            dados.cursoId,
            dados.semestreCurricular ?? null,
            dados.turnoId,
            Boolean(dados.gerencial),
            dados.ativo === undefined ? true : Boolean(dados.ativo),
        ]
    );
    return resultado.rows[0] || null;
};

/**
 * Liga/desliga a turma preservando o historico de aulas.
 * @param {number} id
 * @param {boolean} ativo
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo, executor = db) => {
    const resultado = await executor.query(
        `UPDATE turmas SET ativo = $2 WHERE id = $1 RETURNING ${COLUNAS.replace(/t\./g, '')}`,
        [id, Boolean(ativo)]
    );
    return resultado.rows[0] || null;
};

/**
 * Exclusao destrutiva. Deve ser chamada apenas apos confirmar que a turma nao
 * possui aulas (`contarAulas`).
 * @param {number} id
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>} true quando algum registro foi removido
 */
const excluir = async (id, executor = db) => {
    const resultado = await executor.query('DELETE FROM turmas WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * Quantidade de aulas da turma, separadas por situacao.
 * @param {number} turmaId
 * @param {{query: Function}} [executor]
 * @returns {Promise<{total:number, ativas:number}>}
 */
const contarAulas = async (turmaId, executor = db) => {
    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ativo)::int AS ativas
           FROM aulas
          WHERE turma_id = $1`,
        [inteiroOuNulo(turmaId)]
    );
    return resultado.rows[0] || { total: 0, ativas: 0 };
};

/**
 * Indica se o codigo ja esta em uso por outra turma do mesmo periodo letivo E do
 * mesmo campus (mesma regra do indice `ux_turma_codigo_periodo_campus`,
 * case-insensitive).
 *
 * O campus faz parte da chave porque o ERP repete o mesmo codigo em filiais
 * diferentes: "DIR01M1" existe em Asa Sul e em Aguas Claras, e sao turmas
 * distintas, com ofertas distintas.
 *
 * @param {number} periodoLetivoId
 * @param {number} campusId
 * @param {string|null} codigo
 * @param {number|null} [ignorarId] id da turma sendo editada
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>}
 */
const codigoEmUso = async (periodoLetivoId, campusId, codigo, ignorarId = null, executor = db) => {
    const texto = typeof codigo === 'string' ? codigo.trim() : '';
    if (!texto) return false;

    const resultado = await executor.query(
        `SELECT 1
           FROM turmas
          WHERE periodo_letivo_id = $1
            AND campus_id = $2
            AND LOWER(codigo) = LOWER($3)
            AND ($4::int IS NULL OR id <> $4::int)
          LIMIT 1`,
        [periodoLetivoId, campusId, texto, inteiroOuNulo(ignorarId)]
    );

    return resultado.rowCount > 0;
};

/**
 * O curso e ofertado no campus informado (`curso_campus`)?
 * @param {number} cursoId
 * @param {number} campusId
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>}
 */
const cursoOfertadoNoCampus = async (cursoId, campusId, executor = db) => {
    const curso = inteiroOuNulo(cursoId);
    const campus = inteiroOuNulo(campusId);
    if (curso === null || campus === null) return false;

    const resultado = await executor.query(
        'SELECT 1 FROM curso_campus WHERE curso_id = $1 AND campus_id = $2 LIMIT 1',
        [curso, campus]
    );
    return resultado.rowCount > 0;
};

/**
 * Nomes dos campus onde o curso e ofertado (usado na mensagem de erro).
 * @param {number} cursoId
 * @param {{query: Function}} [executor]
 * @returns {Promise<string[]>}
 */
const campusDoCurso = async (cursoId, executor = db) => {
    const resultado = await executor.query(
        `SELECT ca.nome
           FROM curso_campus cc
           JOIN campus ca ON ca.id = cc.campus_id
          WHERE cc.curso_id = $1
          ORDER BY ca.nome`,
        [inteiroOuNulo(cursoId)]
    );
    return resultado.rows.map((linha) => linha.nome);
};

/**
 * Pares curso/campus ativos, usados pelo formulario para orientar a escolha.
 * @param {{query: Function}} [executor]
 * @returns {Promise<Record<number, number[]>>} cursoId -> ids de campus
 */
const mapaCursoCampus = async (executor = db) => {
    const resultado = await executor.query(
        'SELECT curso_id, campus_id FROM curso_campus ORDER BY curso_id, campus_id'
    );

    return resultado.rows.reduce((mapa, linha) => {
        const curso = Number(linha.curso_id);
        if (!mapa[curso]) mapa[curso] = [];
        mapa[curso].push(Number(linha.campus_id));
        return mapa;
    }, {});
};

// ---------------------------------------------------------------------------
// Opcoes dos selects
//
// Todas trazem apenas registros ativos, mais o valor ja gravado na turma quando
// ele estiver inativo (`incluirId`), para nao perder o vinculo em uma edicao.
// ---------------------------------------------------------------------------

/**
 * @param {number|null} [incluirId]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const opcoesPeriodos = async (incluirId = null, executor = db) => {
    const resultado = await executor.query(
        `SELECT id, codigo, ano, semestre, atual, ativo
           FROM periodos_letivos
          WHERE ativo OR id = $1::int
          ORDER BY ano DESC, semestre DESC, codigo DESC`,
        [inteiroOuNulo(incluirId)]
    );
    return resultado.rows;
};

/**
 * @param {number|null} [incluirId]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const opcoesCampus = async (incluirId = null, executor = db) => {
    const resultado = await executor.query(
        `SELECT id, nome, sigla, ativo
           FROM campus
          WHERE ativo OR id = $1::int
          ORDER BY nome`,
        [inteiroOuNulo(incluirId)]
    );
    return resultado.rows;
};

/**
 * Cursos ativos. Quando `restringirIds` e um array, apenas esses cursos sao
 * devolvidos (escopo do coordenador); `null` significa "sem restricao".
 * @param {number|null} [incluirId]
 * @param {number[]|null} [restringirIds]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const opcoesCursos = async (incluirId = null, restringirIds = null, executor = db) => {
    const resultado = await executor.query(
        `SELECT id, nome, sigla, ativo, semestres_total
           FROM cursos
          WHERE (ativo OR id = $1::int)
            AND ($2::int[] IS NULL OR id = ANY($2::int[]))
          ORDER BY nome`,
        [inteiroOuNulo(incluirId), Array.isArray(restringirIds) ? restringirIds : null]
    );
    return resultado.rows;
};

/**
 * @param {number|null} [incluirId]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const opcoesTurnos = async (incluirId = null, executor = db) => {
    const resultado = await executor.query(
        `SELECT id, nome, slug, ordem, ativo
           FROM turnos
          WHERE ativo OR id = $1::int
          ORDER BY ordem, nome`,
        [inteiroOuNulo(incluirId)]
    );
    return resultado.rows;
};

module.exports = {
    listar,
    contar,
    contarIntegradas,
    buscarPorId,
    inserir,
    atualizar,
    definirAtivo,
    excluir,
    contarAulas,
    codigoEmUso,
    cursoOfertadoNoCampus,
    campusDoCurso,
    mapaCursoCampus,
    opcoesPeriodos,
    opcoesCampus,
    opcoesCursos,
    opcoesTurnos,
};
