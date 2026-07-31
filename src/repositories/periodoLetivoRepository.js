/**
 * Acesso a dados de periodos letivos.
 *
 * O banco tem um indice unico parcial (`ux_periodo_letivo_atual`) que permite no
 * maximo UM periodo marcado como atual. Por isso toda gravacao que possa marcar
 * `atual = TRUE` roda em transacao e desmarca os demais ANTES de gravar — assim
 * o indice nunca e violado e o usuario nunca ve um erro 500 do banco.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

const COLUNAS = `
    p.id,
    p.codigo,
    p.ano,
    p.semestre,
    p.data_inicio,
    p.data_fim,
    p.atual,
    p.ativo,
    p.criado_em,
    p.atualizado_em
`;

const AGREGADOS = `
    (SELECT COUNT(*)::int FROM turmas t WHERE t.periodo_letivo_id = p.id) AS total_turmas,
    (SELECT COUNT(*)::int FROM turmas t WHERE t.periodo_letivo_id = p.id AND t.ativo) AS turmas_ativas
`;

/**
 * Monta o WHERE da listagem.
 * @param {{busca?:string|null, ano?:number|null, status?:boolean|null}} filtros
 */
const montarFiltro = ({ busca, ano, status } = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['p.codigo'], busca);
    filtro.igual('p.ano', ano);
    filtro.booleano('p.ativo', status);
    return filtro;
};

/**
 * Lista periodos paginados, do mais recente para o mais antigo.
 * @param {object} filtros
 * @param {{limite?:number, offset?:number}} paginacao
 * @returns {Promise<object[]>}
 */
const listar = async (filtros = {}, { limite = 20, offset = 0 } = {}) => {
    const filtro = montarFiltro(filtros);
    const resultado = await db.query(
        `SELECT ${COLUNAS}, ${AGREGADOS}
           FROM periodos_letivos p
           ${filtro.where}
          ORDER BY p.ano DESC, p.semestre DESC, p.codigo DESC
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
        `SELECT COUNT(*)::int AS total FROM periodos_letivos p ${filtro.where}`,
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
        `SELECT ${COLUNAS}, ${AGREGADOS} FROM periodos_letivos p WHERE p.id = $1 LIMIT 1`,
        [id]
    );
    return resultado.rows[0] || null;
};

/**
 * Procura outro periodo com o mesmo codigo (sem diferenciar maiusculas).
 * @param {string} codigo
 * @param {number|null} [ignorarId]
 * @returns {Promise<object|null>}
 */
const buscarPorCodigo = async (codigo, ignorarId = null) => {
    const resultado = await db.query(
        `SELECT id, codigo FROM periodos_letivos
          WHERE LOWER(codigo) = LOWER($1)
            AND ($2::int IS NULL OR id <> $2)
          LIMIT 1`,
        [codigo, ignorarId]
    );
    return resultado.rows[0] || null;
};

/**
 * Anos distintos ja cadastrados, para o filtro da listagem.
 * @returns {Promise<number[]>}
 */
const listarAnos = async () => {
    const resultado = await db.query('SELECT DISTINCT ano FROM periodos_letivos ORDER BY ano DESC');
    return resultado.rows.map((linha) => Number(linha.ano));
};

/**
 * Desmarca todos os periodos atuais, exceto o informado.
 * @param {import('pg').PoolClient} cliente cliente da transacao em andamento
 * @param {number|null} [manterId]
 */
const desmarcarAtuais = async (cliente, manterId = null) => {
    await cliente.query(
        'UPDATE periodos_letivos SET atual = FALSE WHERE atual AND ($1::int IS NULL OR id <> $1)',
        [manterId]
    );
};

/**
 * Cria o periodo. Quando `atual` e verdadeiro, desmarca o anterior na mesma
 * transacao para nao violar `ux_periodo_letivo_atual`.
 * @param {{codigo:string, ano:number, semestre:number, dataInicio:string|null,
 *          dataFim:string|null, atual:boolean, ativo:boolean}} dados
 * @returns {Promise<object>}
 */
const criar = async (dados) =>
    db.transacao(async (cliente) => {
        // Um periodo inativo nunca pode ser o periodo atual do sistema.
        const atual = Boolean(dados.atual) && dados.ativo !== false;
        if (atual) await desmarcarAtuais(cliente);

        const resultado = await cliente.query(
            `INSERT INTO periodos_letivos
                (codigo, ano, semestre, data_inicio, data_fim, atual, ativo)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, codigo, ano, semestre, data_inicio, data_fim, atual, ativo`,
            [
                dados.codigo,
                dados.ano,
                dados.semestre,
                dados.dataInicio,
                dados.dataFim,
                atual,
                dados.ativo,
            ]
        );

        return resultado.rows[0];
    });

/**
 * Atualiza o periodo, tratando a exclusividade de `atual` na mesma transacao.
 * @param {number} id
 * @param {object} dados mesmo formato de `criar`
 * @returns {Promise<object|null>}
 */
const atualizar = async (id, dados) =>
    db.transacao(async (cliente) => {
        const atual = Boolean(dados.atual) && dados.ativo !== false;
        if (atual) await desmarcarAtuais(cliente, id);

        const resultado = await cliente.query(
            `UPDATE periodos_letivos
                SET codigo = $2,
                    ano = $3,
                    semestre = $4,
                    data_inicio = $5,
                    data_fim = $6,
                    atual = $7,
                    ativo = $8
              WHERE id = $1
              RETURNING id, codigo, ano, semestre, data_inicio, data_fim, atual, ativo`,
            [
                id,
                dados.codigo,
                dados.ano,
                dados.semestre,
                dados.dataInicio,
                dados.dataFim,
                atual,
                dados.ativo,
            ]
        );

        return resultado.rows[0] || null;
    });

/**
 * Marca o periodo como atual, desmarcando o anterior na mesma transacao.
 * Reativa o periodo quando necessario: o periodo atual precisa estar ativo.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
const definirAtual = async (id) =>
    db.transacao(async (cliente) => {
        const existente = await cliente.query(
            'SELECT id FROM periodos_letivos WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (existente.rowCount === 0) return null;

        await desmarcarAtuais(cliente, id);

        const resultado = await cliente.query(
            `UPDATE periodos_letivos SET atual = TRUE, ativo = TRUE
              WHERE id = $1
              RETURNING id, codigo, atual, ativo`,
            [id]
        );

        return resultado.rows[0];
    });

/**
 * Ativa ou inativa o periodo. Ao inativar, tambem deixa de ser o periodo atual.
 * @param {number} id
 * @param {boolean} ativo
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo) => {
    const resultado = await db.query(
        `UPDATE periodos_letivos
            SET ativo = $2,
                atual = CASE WHEN $2 THEN atual ELSE FALSE END
          WHERE id = $1
          RETURNING id, codigo, atual, ativo`,
        [id, ativo]
    );
    return resultado.rows[0] || null;
};

/**
 * Remove o periodo. So deve ser chamado quando nao houver turmas.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
const excluir = async (id) => {
    const resultado = await db.query('DELETE FROM periodos_letivos WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * @param {number} id
 * @returns {Promise<{turmas:number, turmasAtivas:number}>}
 */
const contarVinculos = async (id) => {
    const resultado = await db.query(
        `SELECT
            (SELECT COUNT(*)::int FROM turmas WHERE periodo_letivo_id = $1) AS turmas,
            (SELECT COUNT(*)::int FROM turmas WHERE periodo_letivo_id = $1 AND ativo) AS turmas_ativas`,
        [id]
    );
    return { turmas: resultado.rows[0].turmas, turmasAtivas: resultado.rows[0].turmas_ativas };
};

module.exports = {
    listar,
    contar,
    buscarPorId,
    buscarPorCodigo,
    listarAnos,
    criar,
    atualizar,
    definirAtual,
    definirAtivo,
    excluir,
    contarVinculos,
};
