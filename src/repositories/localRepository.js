/**
 * Acesso a dados de locais (salas, laboratorios, auditorios...).
 *
 * `aulas.local_id` usa ON DELETE SET NULL, entao o banco NAO impede a exclusao
 * de um local em uso: quem protege o historico e `emUso()`, sempre consultado
 * antes de qualquer exclusao.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

const COLUNAS_LISTA = `
    l.id,
    l.campus_id,
    l.nome,
    l.codigo,
    l.tipo,
    l.capacidade,
    l.ativo,
    l.criado_em,
    l.atualizado_em,
    c.nome AS campus_nome,
    c.sigla AS campus_sigla,
    c.ativo AS campus_ativo,
    (SELECT COUNT(*) FROM aulas a WHERE a.local_id = l.id)::int AS total_aulas,
    (SELECT COUNT(*) FROM aulas a WHERE a.local_id = l.id AND a.ativo)::int AS total_aulas_ativas
`;

/**
 * @param {{busca?:string|null, campusId?:number|null, tipo?:string|null,
 *          ativo?:boolean|null, campusIds?:number[]|null}} [filtros]
 *        `campusIds` restringe ao escopo do usuario (null = sem restricao).
 * @returns {import('../utils/consulta').ConstrutorFiltro}
 */
const montarFiltro = ({
    busca = null,
    campusId = null,
    tipo = null,
    ativo = null,
    campusIds = null,
} = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['l.nome', 'l.codigo'], busca);
    filtro.igual('l.campus_id', campusId);
    filtro.igual('l.tipo', tipo);
    filtro.booleano('l.ativo', ativo);
    if (Array.isArray(campusIds)) filtro.em('l.campus_id', campusIds);
    return filtro;
};

/**
 * Lista locais paginados, ordenados por campus e nome.
 * @param {{busca?:string|null, campusId?:number|null, tipo?:string|null,
 *          ativo?:boolean|null, campusIds?:number[]|null,
 *          limite?:number, offset?:number}} [filtros]
 * @returns {Promise<object[]>}
 */
const listar = async ({
    busca,
    campusId,
    tipo,
    ativo,
    campusIds,
    limite = 20,
    offset = 0,
} = {}) => {
    const filtro = montarFiltro({ busca, campusId, tipo, ativo, campusIds });
    const indiceLimite = filtro.proximoIndice;

    const resultado = await db.query(
        `SELECT ${COLUNAS_LISTA}
           FROM locais l
           JOIN campus c ON c.id = l.campus_id
           ${filtro.where}
          ORDER BY c.nome, l.nome
          LIMIT $${indiceLimite} OFFSET $${indiceLimite + 1}`,
        [...filtro.parametros, limite, offset]
    );
    return resultado.rows;
};

/**
 * @param {object} [filtros] mesmos filtros de `listar`
 * @returns {Promise<number>}
 */
const contar = async ({ busca, campusId, tipo, ativo, campusIds } = {}) => {
    const filtro = montarFiltro({ busca, campusId, tipo, ativo, campusIds });
    const resultado = await db.query(
        `SELECT COUNT(*)::int AS total
           FROM locais l
           JOIN campus c ON c.id = l.campus_id
           ${filtro.where}`,
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
        `SELECT ${COLUNAS_LISTA}
           FROM locais l
           JOIN campus c ON c.id = l.campus_id
          WHERE l.id = $1
          LIMIT 1`,
        [identificador]
    );
    return resultado.rows[0] || null;
};

/**
 * Verifica se ja existe um local com o mesmo nome no campus (case-insensitive).
 * @param {number} campusId
 * @param {string} nome
 * @param {number|null} [ignorarId]
 * @returns {Promise<object|null>}
 */
const buscarPorNomeNoCampus = async (campusId, nome, ignorarId = null) => {
    const resultado = await db.query(
        `SELECT l.id, l.nome
           FROM locais l
          WHERE l.campus_id = $1
            AND LOWER(l.nome) = LOWER($2)
            AND ($3::int IS NULL OR l.id <> $3::int)
          LIMIT 1`,
        [Number(campusId), String(nome || '').trim(), ignorarId ? Number(ignorarId) : null]
    );
    return resultado.rows[0] || null;
};

/**
 * Insere um local.
 * @param {{campus_id:number, nome:string, codigo:string|null, tipo:string,
 *          capacidade:number|null, ativo:boolean}} dados
 * @returns {Promise<object>}
 */
const inserir = async ({ campus_id: campusId, nome, codigo, tipo, capacidade, ativo }) => {
    const resultado = await db.query(
        `INSERT INTO locais (campus_id, nome, codigo, tipo, capacidade, ativo)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, campus_id, nome, codigo, tipo, capacidade, ativo`,
        [campusId, nome, codigo, tipo, capacidade, ativo]
    );
    return resultado.rows[0];
};

/**
 * Atualiza um local.
 * @param {number} id
 * @param {{campus_id:number, nome:string, codigo:string|null, tipo:string,
 *          capacidade:number|null, ativo:boolean}} dados
 * @returns {Promise<object|null>}
 */
const atualizar = async (id, { campus_id: campusId, nome, codigo, tipo, capacidade, ativo }) => {
    const resultado = await db.query(
        `UPDATE locais
            SET campus_id = $1, nome = $2, codigo = $3, tipo = $4, capacidade = $5, ativo = $6
          WHERE id = $7
      RETURNING id, campus_id, nome, codigo, tipo, capacidade, ativo`,
        [campusId, nome, codigo, tipo, capacidade, ativo, Number(id)]
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
        `UPDATE locais SET ativo = $1 WHERE id = $2 RETURNING id, nome, ativo`,
        [Boolean(ativo), Number(id)]
    );
    return resultado.rows[0] || null;
};

/**
 * Remove um local. Use apenas depois de conferir `emUso()`.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
const excluir = async (id) => {
    const resultado = await db.query('DELETE FROM locais WHERE id = $1', [Number(id)]);
    return resultado.rowCount > 0;
};

/**
 * Quantidade de aulas (ativas ou nao) que apontam para o local.
 * @param {number} id
 * @returns {Promise<number>}
 */
const contarAulas = async (id) => {
    const resultado = await db.query(
        'SELECT COUNT(*)::int AS total FROM aulas WHERE local_id = $1',
        [Number(id)]
    );
    return resultado.rows[0].total;
};

/**
 * O local ja foi usado em alguma aula?
 * @param {number} id
 * @returns {Promise<boolean>}
 */
const emUso = async (id) => (await contarAulas(id)) > 0;

module.exports = {
    listar,
    contar,
    buscarPorId,
    buscarPorNomeNoCampus,
    inserir,
    atualizar,
    definirAtivo,
    excluir,
    contarAulas,
    emUso,
};
