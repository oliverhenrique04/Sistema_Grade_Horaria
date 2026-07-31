/**
 * Acesso a dados de campus.
 *
 * Todo o SQL do recurso vive aqui e e sempre parametrizado: o WHERE dinamico e
 * montado com o construtor de `src/utils/consulta.js`, que numera os
 * placeholders sem interpolar valores.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

/** Colunas devolvidas nas listagens, ja com as contagens de vinculos. */
const COLUNAS_LISTA = `
    c.id,
    c.nome,
    c.sigla,
    c.ativo,
    c.criado_em,
    c.atualizado_em,
    (SELECT COUNT(*) FROM locais l WHERE l.campus_id = c.id)::int AS total_locais,
    (SELECT COUNT(*) FROM locais l WHERE l.campus_id = c.id AND l.ativo)::int AS total_locais_ativos,
    (SELECT COUNT(*) FROM turmas t WHERE t.campus_id = c.id)::int AS total_turmas,
    (SELECT COUNT(*) FROM turmas t WHERE t.campus_id = c.id AND t.ativo)::int AS total_turmas_ativas
`;

/**
 * Monta o filtro comum de listagem e contagem.
 * @param {{busca?:string|null, ativo?:boolean|null, ids?:number[]|null}} [filtros]
 * @returns {import('../utils/consulta').ConstrutorFiltro}
 */
const montarFiltro = ({ busca = null, ativo = null, ids = null } = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['c.nome', 'c.sigla'], busca);
    filtro.booleano('c.ativo', ativo);
    if (Array.isArray(ids)) filtro.em('c.id', ids);
    return filtro;
};

/**
 * Lista campus paginados, em ordem alfabetica.
 * @param {{busca?:string|null, ativo?:boolean|null, ids?:number[]|null,
 *          limite?:number, offset?:number}} [filtros]
 * @returns {Promise<object[]>}
 */
const listar = async ({ busca, ativo, ids, limite = 20, offset = 0 } = {}) => {
    const filtro = montarFiltro({ busca, ativo, ids });
    const indiceLimite = filtro.proximoIndice;

    const resultado = await db.query(
        `SELECT ${COLUNAS_LISTA}
           FROM campus c
           ${filtro.where}
          ORDER BY c.nome
          LIMIT $${indiceLimite} OFFSET $${indiceLimite + 1}`,
        [...filtro.parametros, limite, offset]
    );

    return resultado.rows;
};

/**
 * Conta os campus que atendem aos filtros.
 * @param {{busca?:string|null, ativo?:boolean|null, ids?:number[]|null}} [filtros]
 * @returns {Promise<number>}
 */
const contar = async ({ busca, ativo, ids } = {}) => {
    const filtro = montarFiltro({ busca, ativo, ids });
    const resultado = await db.query(
        `SELECT COUNT(*)::int AS total FROM campus c ${filtro.where}`,
        filtro.parametros
    );
    return resultado.rows[0].total;
};

/**
 * Busca um campus pelo id.
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
const buscarPorId = async (id) => {
    const identificador = Number(id);
    if (!Number.isInteger(identificador) || identificador <= 0) return null;

    const resultado = await db.query(
        `SELECT ${COLUNAS_LISTA} FROM campus c WHERE c.id = $1 LIMIT 1`,
        [identificador]
    );
    return resultado.rows[0] || null;
};

/**
 * Busca um campus pelo nome (comparacao case-insensitive), ignorando um id.
 * @param {string} nome
 * @param {number|null} [ignorarId]
 * @returns {Promise<object|null>}
 */
const buscarPorNome = async (nome, ignorarId = null) => {
    const filtro = novoFiltro();
    filtro.adicionar('LOWER(c.nome) = LOWER(?)', String(nome || '').trim());
    if (ignorarId) filtro.adicionar('c.id <> ?', Number(ignorarId));

    const resultado = await db.query(
        `SELECT c.id, c.nome FROM campus c ${filtro.where} LIMIT 1`,
        filtro.parametros
    );
    return resultado.rows[0] || null;
};

/**
 * Lista campus para uso em selects (sem paginacao).
 * @param {{apenasAtivos?:boolean, ids?:number[]|null, incluirId?:number|null}} [opcoes]
 *        `incluirId` garante que o campus ja vinculado a um registro apareca na
 *        lista mesmo quando estiver inativo ou fora do escopo.
 * @returns {Promise<object[]>}
 */
const listarParaSelecao = async ({ apenasAtivos = true, ids = null, incluirId = null } = {}) => {
    // SQL estatico: os tres eixos do filtro sao resolvidos por parametro, sem
    // concatenacao, porque a clausula combina AND com um OR de excecao.
    const resultado = await db.query(
        `SELECT c.id, c.nome, c.sigla, c.ativo
           FROM campus c
          WHERE (
                    (NOT $1::boolean OR c.ativo)
                AND ($2::int[] IS NULL OR c.id = ANY($2::int[]))
                )
             OR ($3::int IS NOT NULL AND c.id = $3::int)
          ORDER BY c.nome`,
        [
            Boolean(apenasAtivos),
            Array.isArray(ids) ? ids : null,
            incluirId ? Number(incluirId) : null,
        ]
    );
    return resultado.rows;
};

/**
 * Insere um campus.
 * @param {{nome:string, sigla:string|null, ativo:boolean}} dados
 * @returns {Promise<object>} linha criada
 */
const inserir = async ({ nome, sigla, ativo }) => {
    const resultado = await db.query(
        `INSERT INTO campus (nome, sigla, ativo)
         VALUES ($1, $2, $3)
         RETURNING id, nome, sigla, ativo`,
        [nome, sigla, ativo]
    );
    return resultado.rows[0];
};

/**
 * Atualiza um campus.
 * @param {number} id
 * @param {{nome:string, sigla:string|null, ativo:boolean}} dados
 * @returns {Promise<object|null>} linha atualizada ou null quando o id nao existe
 */
const atualizar = async (id, { nome, sigla, ativo }) => {
    const resultado = await db.query(
        `UPDATE campus
            SET nome = $1, sigla = $2, ativo = $3
          WHERE id = $4
      RETURNING id, nome, sigla, ativo`,
        [nome, sigla, ativo, Number(id)]
    );
    return resultado.rows[0] || null;
};

/**
 * Ativa ou inativa um campus.
 * @param {number} id
 * @param {boolean} ativo
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo) => {
    const resultado = await db.query(
        `UPDATE campus SET ativo = $1 WHERE id = $2 RETURNING id, nome, ativo`,
        [Boolean(ativo), Number(id)]
    );
    return resultado.rows[0] || null;
};

/**
 * Remove um campus. Use apenas depois de conferir que nao ha vinculos.
 * @param {number} id
 * @returns {Promise<boolean>} true quando algum registro foi removido
 */
const excluir = async (id) => {
    const resultado = await db.query('DELETE FROM campus WHERE id = $1', [Number(id)]);
    return resultado.rowCount > 0;
};

/**
 * Contagem de vinculos do campus, usada para decidir entre inativar e excluir.
 * @param {number} id
 * @returns {Promise<{locais:number, turmas:number, turmasAtivas:number,
 *                    cursos:number, usuarios:number, total:number}>}
 */
const contarVinculos = async (id) => {
    const identificador = Number(id);
    const resultado = await db.query(
        `SELECT
            (SELECT COUNT(*) FROM locais WHERE campus_id = $1)::int AS locais,
            (SELECT COUNT(*) FROM turmas WHERE campus_id = $1)::int AS turmas,
            (SELECT COUNT(*) FROM turmas WHERE campus_id = $1 AND ativo)::int AS turmas_ativas,
            (SELECT COUNT(*) FROM curso_campus WHERE campus_id = $1)::int AS cursos,
            (SELECT COUNT(*) FROM usuario_campus WHERE campus_id = $1)::int AS usuarios`,
        [identificador]
    );

    const linha = resultado.rows[0];
    return {
        locais: linha.locais,
        turmas: linha.turmas,
        turmasAtivas: linha.turmas_ativas,
        cursos: linha.cursos,
        usuarios: linha.usuarios,
        total: linha.locais + linha.turmas + linha.cursos + linha.usuarios,
    };
};

module.exports = {
    listar,
    contar,
    buscarPorId,
    buscarPorNome,
    listarParaSelecao,
    inserir,
    atualizar,
    definirAtivo,
    excluir,
    contarVinculos,
};
