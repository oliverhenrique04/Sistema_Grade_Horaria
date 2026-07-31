/**
 * Acesso a dados de turnos.
 *
 * A quantidade de horarios de um turno NAO e fixa: `total_horarios` sempre vem
 * de `horarios_turno`, nunca de constante no codigo.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

const COLUNAS_LISTA = `
    t.id,
    t.nome,
    t.slug,
    t.icone,
    t.tema_class,
    t.ordem,
    t.ativo,
    t.criado_em,
    t.atualizado_em,
    (SELECT COUNT(*) FROM horarios_turno h WHERE h.turno_id = t.id)::int AS total_horarios,
    (SELECT COUNT(*) FROM horarios_turno h WHERE h.turno_id = t.id AND h.ativo)::int
        AS total_horarios_ativos,
    (SELECT COUNT(*) FROM turmas tu WHERE tu.turno_id = t.id)::int AS total_turmas,
    (SELECT COUNT(*) FROM turmas tu WHERE tu.turno_id = t.id AND tu.ativo)::int AS total_turmas_ativas
`;

/**
 * @param {{busca?:string|null, ativo?:boolean|null}} [filtros]
 * @returns {import('../utils/consulta').ConstrutorFiltro}
 */
const montarFiltro = ({ busca = null, ativo = null } = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['t.nome', 't.slug'], busca);
    filtro.booleano('t.ativo', ativo);
    return filtro;
};

/**
 * Lista turnos paginados, na ordem de exibicao definida pelo cadastro.
 * @param {{busca?:string|null, ativo?:boolean|null, limite?:number, offset?:number}} [filtros]
 * @returns {Promise<object[]>}
 */
const listar = async ({ busca, ativo, limite = 20, offset = 0 } = {}) => {
    const filtro = montarFiltro({ busca, ativo });
    const indiceLimite = filtro.proximoIndice;

    const resultado = await db.query(
        `SELECT ${COLUNAS_LISTA}
           FROM turnos t
           ${filtro.where}
          ORDER BY t.ordem, t.nome
          LIMIT $${indiceLimite} OFFSET $${indiceLimite + 1}`,
        [...filtro.parametros, limite, offset]
    );
    return resultado.rows;
};

/**
 * @param {{busca?:string|null, ativo?:boolean|null}} [filtros]
 * @returns {Promise<number>}
 */
const contar = async ({ busca, ativo } = {}) => {
    const filtro = montarFiltro({ busca, ativo });
    const resultado = await db.query(
        `SELECT COUNT(*)::int AS total FROM turnos t ${filtro.where}`,
        filtro.parametros
    );
    return resultado.rows[0].total;
};

/**
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
const buscarPorId = async (id) => {
    const identificador = Number(id);
    if (!Number.isInteger(identificador) || identificador <= 0) return null;

    const resultado = await db.query(
        `SELECT ${COLUNAS_LISTA} FROM turnos t WHERE t.id = $1 LIMIT 1`,
        [identificador]
    );
    return resultado.rows[0] || null;
};

/**
 * Busca um turno pelo nome (case-insensitive), ignorando um id.
 * @param {string} nome
 * @param {number|null} [ignorarId]
 * @returns {Promise<object|null>}
 */
const buscarPorNome = async (nome, ignorarId = null) => {
    const resultado = await db.query(
        `SELECT t.id, t.nome
           FROM turnos t
          WHERE LOWER(t.nome) = LOWER($1)
            AND ($2::int IS NULL OR t.id <> $2::int)
          LIMIT 1`,
        [String(nome || '').trim(), ignorarId ? Number(ignorarId) : null]
    );
    return resultado.rows[0] || null;
};

/**
 * Busca um turno pelo slug, ignorando um id.
 * @param {string} slug
 * @param {number|null} [ignorarId]
 * @returns {Promise<object|null>}
 */
const buscarPorSlug = async (slug, ignorarId = null) => {
    const resultado = await db.query(
        `SELECT t.id, t.nome, t.slug
           FROM turnos t
          WHERE t.slug = $1
            AND ($2::int IS NULL OR t.id <> $2::int)
          LIMIT 1`,
        [
            String(slug || '')
                .trim()
                .toLowerCase(),
            ignorarId ? Number(ignorarId) : null,
        ]
    );
    return resultado.rows[0] || null;
};

/**
 * Lista turnos para selects e filtros.
 * @param {{apenasAtivos?:boolean, incluirId?:number|null}} [opcoes]
 * @returns {Promise<object[]>}
 */
const listarParaSelecao = async ({ apenasAtivos = true, incluirId = null } = {}) => {
    const resultado = await db.query(
        `SELECT t.id, t.nome, t.slug, t.icone, t.ordem, t.ativo,
                (SELECT COUNT(*) FROM horarios_turno h WHERE h.turno_id = t.id)::int
                    AS total_horarios
           FROM turnos t
          WHERE (NOT $1::boolean OR t.ativo)
             OR ($2::int IS NOT NULL AND t.id = $2::int)
          ORDER BY t.ordem, t.nome`,
        [Boolean(apenasAtivos), incluirId ? Number(incluirId) : null]
    );
    return resultado.rows;
};

/**
 * Insere um turno.
 * @param {{nome:string, slug:string, icone:string, tema_class:string|null,
 *          ordem:number, ativo:boolean}} dados
 * @returns {Promise<object>}
 */
const inserir = async ({ nome, slug, icone, tema_class: temaClass, ordem, ativo }) => {
    const resultado = await db.query(
        `INSERT INTO turnos (nome, slug, icone, tema_class, ordem, ativo)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, nome, slug, icone, tema_class, ordem, ativo`,
        [nome, slug, icone, temaClass, ordem, ativo]
    );
    return resultado.rows[0];
};

/**
 * Atualiza um turno.
 * @param {number} id
 * @param {{nome:string, slug:string, icone:string, tema_class:string|null,
 *          ordem:number, ativo:boolean}} dados
 * @returns {Promise<object|null>}
 */
const atualizar = async (id, { nome, slug, icone, tema_class: temaClass, ordem, ativo }) => {
    const resultado = await db.query(
        `UPDATE turnos
            SET nome = $1, slug = $2, icone = $3, tema_class = $4, ordem = $5, ativo = $6
          WHERE id = $7
      RETURNING id, nome, slug, icone, tema_class, ordem, ativo`,
        [nome, slug, icone, temaClass, ordem, ativo, Number(id)]
    );
    return resultado.rows[0] || null;
};

/**
 * @param {number} id
 * @param {boolean} ativo
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo) => {
    const resultado = await db.query(
        `UPDATE turnos SET ativo = $1 WHERE id = $2 RETURNING id, nome, ativo`,
        [Boolean(ativo), Number(id)]
    );
    return resultado.rows[0] || null;
};

/**
 * Remove um turno. Use apenas depois de conferir que nao ha vinculos.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
const excluir = async (id) => {
    const resultado = await db.query('DELETE FROM turnos WHERE id = $1', [Number(id)]);
    return resultado.rowCount > 0;
};

/**
 * Vinculos do turno (horarios cadastrados e turmas que o utilizam).
 * @param {number} id
 * @returns {Promise<{horarios:number, turmas:number, turmasAtivas:number, total:number}>}
 */
const contarVinculos = async (id) => {
    const resultado = await db.query(
        `SELECT
            (SELECT COUNT(*) FROM horarios_turno WHERE turno_id = $1)::int AS horarios,
            (SELECT COUNT(*) FROM turmas WHERE turno_id = $1)::int AS turmas,
            (SELECT COUNT(*) FROM turmas WHERE turno_id = $1 AND ativo)::int AS turmas_ativas`,
        [Number(id)]
    );

    const linha = resultado.rows[0];
    return {
        horarios: linha.horarios,
        turmas: linha.turmas,
        turmasAtivas: linha.turmas_ativas,
        total: linha.horarios + linha.turmas,
    };
};

module.exports = {
    listar,
    contar,
    buscarPorId,
    buscarPorNome,
    buscarPorSlug,
    listarParaSelecao,
    inserir,
    atualizar,
    definirAtivo,
    excluir,
    contarVinculos,
};
