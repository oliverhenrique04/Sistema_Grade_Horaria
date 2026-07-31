/**
 * Acesso a dados de professores.
 *
 * O e-mail e unico sem diferenciar maiusculas — o banco garante isso com
 * `ux_professor_email ON professores (LOWER(email))`. As consultas de unicidade
 * daqui usam a mesma comparacao.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

const COLUNAS = `
    p.id,
    p.nome,
    p.email,
    p.ativo,
    p.criado_em,
    p.atualizado_em
`;

const AGREGADOS = `
    (SELECT COUNT(*)::int FROM aulas a WHERE a.professor_id = p.id) AS total_aulas,
    (SELECT COUNT(*)::int FROM aulas a WHERE a.professor_id = p.id AND a.ativo) AS aulas_ativas
`;

/**
 * Monta o WHERE da listagem.
 * @param {{busca?:string|null, status?:boolean|null}} filtros
 */
const montarFiltro = ({ busca, status } = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['p.nome', 'p.email'], busca);
    filtro.booleano('p.ativo', status);
    return filtro;
};

/**
 * Lista professores paginados, em ordem alfabetica.
 * @param {object} filtros
 * @param {{limite?:number, offset?:number}} paginacao
 * @returns {Promise<object[]>}
 */
const listar = async (filtros = {}, { limite = 20, offset = 0 } = {}) => {
    const filtro = montarFiltro(filtros);
    const resultado = await db.query(
        `SELECT ${COLUNAS}, ${AGREGADOS}
           FROM professores p
           ${filtro.where}
          ORDER BY p.nome
          LIMIT $${filtro.proximoIndice} OFFSET $${filtro.proximoIndice + 1}`,
        [...filtro.parametros, limite, offset]
    );
    return resultado.rows;
};

/**
 * @param {object} filtros
 * @returns {Promise<number>}
 */
const contar = async (filtros = {}) => {
    const filtro = montarFiltro(filtros);
    const resultado = await db.query(
        `SELECT COUNT(*)::int AS total FROM professores p ${filtro.where}`,
        filtro.parametros
    );
    return resultado.rows[0].total;
};

/**
 * @param {number} id
 * @returns {Promise<object|null>}
 */
const buscarPorId = async (id) => {
    const resultado = await db.query(
        `SELECT ${COLUNAS}, ${AGREGADOS} FROM professores p WHERE p.id = $1 LIMIT 1`,
        [id]
    );
    return resultado.rows[0] || null;
};

/**
 * Procura outro professor com o mesmo e-mail (sem diferenciar maiusculas).
 * @param {string} email
 * @param {number|null} [ignorarId]
 * @returns {Promise<object|null>}
 */
const buscarPorEmail = async (email, ignorarId = null) => {
    const resultado = await db.query(
        `SELECT id, nome, email FROM professores
          WHERE email IS NOT NULL
            AND LOWER(email) = LOWER($1)
            AND ($2::int IS NULL OR id <> $2)
          LIMIT 1`,
        [email, ignorarId]
    );
    return resultado.rows[0] || null;
};

/**
 * @param {{nome:string, email:string|null, ativo:boolean}} dados
 * @returns {Promise<object>}
 */
const criar = async (dados) => {
    const resultado = await db.query(
        `INSERT INTO professores (nome, email, ativo)
         VALUES ($1, $2, $3)
         RETURNING id, nome, email, ativo`,
        [dados.nome, dados.email, dados.ativo]
    );
    return resultado.rows[0];
};

/**
 * @param {number} id
 * @param {{nome:string, email:string|null, ativo:boolean}} dados
 * @returns {Promise<object|null>}
 */
const atualizar = async (id, dados) => {
    const resultado = await db.query(
        `UPDATE professores
            SET nome = $2, email = $3, ativo = $4
          WHERE id = $1
          RETURNING id, nome, email, ativo`,
        [id, dados.nome, dados.email, dados.ativo]
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
        'UPDATE professores SET ativo = $2 WHERE id = $1 RETURNING id, nome, ativo',
        [id, ativo]
    );
    return resultado.rows[0] || null;
};

/**
 * Remove o professor. So deve ser chamado quando nao houver aulas.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
const excluir = async (id) => {
    const resultado = await db.query('DELETE FROM professores WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * @param {number} id
 * @returns {Promise<{aulas:number, aulasAtivas:number}>}
 */
const contarVinculos = async (id) => {
    const resultado = await db.query(
        `SELECT
            (SELECT COUNT(*)::int FROM aulas WHERE professor_id = $1) AS aulas,
            (SELECT COUNT(*)::int FROM aulas WHERE professor_id = $1 AND ativo) AS aulas_ativas`,
        [id]
    );
    return { aulas: resultado.rows[0].aulas, aulasAtivas: resultado.rows[0].aulas_ativas };
};

module.exports = {
    listar,
    contar,
    buscarPorId,
    buscarPorEmail,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    contarVinculos,
};
