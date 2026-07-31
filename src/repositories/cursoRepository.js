/**
 * Acesso a dados de cursos e do vinculo N:N com campus (`curso_campus`).
 *
 * Todo SQL do recurso vive aqui e e sempre parametrizado — o WHERE dinamico e
 * montado com `utils/consulta`, que cuida da numeracao dos placeholders.
 *
 * As gravacoes que envolvem o vinculo com campus rodam em transacao: o curso e
 * os vinculos precisam ser gravados juntos ou nenhum dos dois.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

const COLUNAS = `
    c.id,
    c.nome,
    c.sigla,
    c.coordenador,
    c.semestres_total,
    c.ativo,
    c.criado_em,
    c.atualizado_em
`;

/** Colunas calculadas exibidas na listagem. */
const AGREGADOS = `
    (SELECT COUNT(*)::int FROM turmas t WHERE t.curso_id = c.id) AS total_turmas,
    (SELECT COUNT(*)::int FROM turmas t WHERE t.curso_id = c.id AND t.ativo) AS turmas_ativas,
    COALESCE((
        SELECT STRING_AGG(cp.nome, ', ' ORDER BY cp.nome)
          FROM curso_campus cc
          JOIN campus cp ON cp.id = cc.campus_id
         WHERE cc.curso_id = c.id
    ), '') AS campus_nomes
`;

/**
 * Monta o WHERE da listagem.
 * @param {{busca?:string|null, campusId?:number|null, status?:boolean|null}} filtros
 */
const montarFiltro = ({ busca, campusId, status } = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['c.nome', 'c.sigla', 'c.coordenador'], busca);
    filtro.booleano('c.ativo', status);
    if (campusId) {
        filtro.adicionar(
            'EXISTS (SELECT 1 FROM curso_campus cc WHERE cc.curso_id = c.id AND cc.campus_id = ?)',
            campusId
        );
    }
    return filtro;
};

/**
 * Lista cursos paginados com contagem de turmas e campus ofertantes.
 * @param {object} filtros
 * @param {{limite?:number, offset?:number}} paginacao
 * @returns {Promise<object[]>}
 */
const listar = async (filtros = {}, { limite = 20, offset = 0 } = {}) => {
    const filtro = montarFiltro(filtros);
    const resultado = await db.query(
        `SELECT ${COLUNAS}, ${AGREGADOS}
           FROM cursos c
           ${filtro.where}
          ORDER BY c.nome
          LIMIT $${filtro.proximoIndice} OFFSET $${filtro.proximoIndice + 1}`,
        [...filtro.parametros, limite, offset]
    );
    return resultado.rows;
};

/**
 * Total de cursos que atendem aos filtros (para a paginacao).
 * @param {object} filtros
 * @returns {Promise<number>}
 */
const contar = async (filtros = {}) => {
    const filtro = montarFiltro(filtros);
    const resultado = await db.query(
        `SELECT COUNT(*)::int AS total FROM cursos c ${filtro.where}`,
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
        `SELECT ${COLUNAS}, ${AGREGADOS} FROM cursos c WHERE c.id = $1 LIMIT 1`,
        [id]
    );
    return resultado.rows[0] || null;
};

/**
 * Procura outro curso com o mesmo nome (comparacao sem diferenciar maiusculas).
 * @param {string} nome
 * @param {number|null} [ignorarId] id do proprio registro, na edicao
 * @returns {Promise<object|null>}
 */
const buscarPorNome = async (nome, ignorarId = null) => {
    const resultado = await db.query(
        `SELECT id, nome FROM cursos
          WHERE LOWER(nome) = LOWER($1)
            AND ($2::int IS NULL OR id <> $2)
          LIMIT 1`,
        [nome, ignorarId]
    );
    return resultado.rows[0] || null;
};

/**
 * Ids dos campus em que o curso e ofertado.
 * @param {number} cursoId
 * @returns {Promise<number[]>}
 */
const listarCampusIds = async (cursoId) => {
    const resultado = await db.query(
        'SELECT campus_id FROM curso_campus WHERE curso_id = $1 ORDER BY campus_id',
        [cursoId]
    );
    return resultado.rows.map((linha) => Number(linha.campus_id));
};

/**
 * Substitui os vinculos com campus (apaga e reinsere).
 * Ids inexistentes sao descartados pelo proprio JOIN com `campus`.
 * @param {import('pg').PoolClient} cliente cliente da transacao em andamento
 * @param {number} cursoId
 * @param {number[]} campusIds
 */
const substituirCampus = async (cliente, cursoId, campusIds = []) => {
    await cliente.query('DELETE FROM curso_campus WHERE curso_id = $1', [cursoId]);

    if (campusIds.length === 0) return;

    await cliente.query(
        `INSERT INTO curso_campus (curso_id, campus_id)
         SELECT $1, cp.id FROM campus cp WHERE cp.id = ANY($2::int[])
         ON CONFLICT DO NOTHING`,
        [cursoId, campusIds]
    );
};

/**
 * Cria o curso e seus vinculos com campus numa unica transacao.
 * @param {{nome:string, sigla:string|null, coordenador:string|null,
 *          semestresTotal:number, ativo:boolean, campusIds:number[]}} dados
 * @returns {Promise<object>} linha criada
 */
const criar = async (dados) =>
    db.transacao(async (cliente) => {
        const resultado = await cliente.query(
            `INSERT INTO cursos (nome, sigla, coordenador, semestres_total, ativo)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, nome, sigla, coordenador, semestres_total, ativo`,
            [dados.nome, dados.sigla, dados.coordenador, dados.semestresTotal, dados.ativo]
        );

        const curso = resultado.rows[0];
        await substituirCampus(cliente, curso.id, dados.campusIds);
        return curso;
    });

/**
 * Atualiza o curso e regrava os vinculos com campus numa unica transacao.
 * @param {number} id
 * @param {object} dados mesmo formato de `criar`
 * @returns {Promise<object|null>} linha atualizada ou null quando o id nao existe
 */
const atualizar = async (id, dados) =>
    db.transacao(async (cliente) => {
        const resultado = await cliente.query(
            `UPDATE cursos
                SET nome = $2, sigla = $3, coordenador = $4, semestres_total = $5, ativo = $6
              WHERE id = $1
              RETURNING id, nome, sigla, coordenador, semestres_total, ativo`,
            [id, dados.nome, dados.sigla, dados.coordenador, dados.semestresTotal, dados.ativo]
        );

        if (resultado.rowCount === 0) return null;

        await substituirCampus(cliente, id, dados.campusIds);
        return resultado.rows[0];
    });

/**
 * Ativa ou inativa o curso.
 * @param {number} id
 * @param {boolean} ativo
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo) => {
    const resultado = await db.query(
        'UPDATE cursos SET ativo = $2 WHERE id = $1 RETURNING id, nome, ativo',
        [id, ativo]
    );
    return resultado.rows[0] || null;
};

/**
 * Remove o curso. So deve ser chamado quando nao houver vinculos.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
const excluir = async (id) => {
    const resultado = await db.query('DELETE FROM cursos WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * Contagem de vinculos que impedem a exclusao definitiva.
 * @param {number} id
 * @returns {Promise<{turmas:number, turmasAtivas:number, disciplinas:number, usuarios:number}>}
 */
const contarVinculos = async (id) => {
    const resultado = await db.query(
        `SELECT
            (SELECT COUNT(*)::int FROM turmas WHERE curso_id = $1) AS turmas,
            (SELECT COUNT(*)::int FROM turmas WHERE curso_id = $1 AND ativo) AS turmas_ativas,
            (SELECT COUNT(*)::int FROM curso_disciplinas WHERE curso_id = $1) AS disciplinas,
            (SELECT COUNT(*)::int FROM usuario_cursos WHERE curso_id = $1) AS usuarios`,
        [id]
    );

    const linha = resultado.rows[0];
    return {
        turmas: linha.turmas,
        turmasAtivas: linha.turmas_ativas,
        disciplinas: linha.disciplinas,
        usuarios: linha.usuarios,
    };
};

/**
 * Campus disponiveis para o formulario e para o filtro da listagem.
 *
 * Vive aqui (e nao num repositorio de campus) porque e uma consulta de apoio ao
 * formulario de curso; o cadastro de campus tem repositorio proprio.
 * @returns {Promise<object[]>}
 */
const listarCampus = async () => {
    const resultado = await db.query('SELECT id, nome, sigla, ativo FROM campus ORDER BY nome');
    return resultado.rows;
};

/**
 * Cursos em formato reduzido, para selects e filtros de outros recursos.
 * @returns {Promise<{id:number, nome:string, sigla:string|null, ativo:boolean}[]>}
 */
const listarParaSelecao = async () => {
    const resultado = await db.query('SELECT id, nome, sigla, ativo FROM cursos ORDER BY nome');
    return resultado.rows;
};

module.exports = {
    listar,
    contar,
    buscarPorId,
    buscarPorNome,
    listarCampusIds,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    contarVinculos,
    listarCampus,
    listarParaSelecao,
};
