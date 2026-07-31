const { Pool } = require('pg');
const config = require('./env');

/**
 * Pool criado sob demanda e recriado apos `encerrar()`.
 *
 * Em producao existe um unico pool, encerrado no desligamento do processo.
 * Nos testes cada arquivo de suite encerra o pool ao terminar; sem a recriacao
 * preguicosa, o arquivo seguinte (que roda no mesmo processo com --runInBand)
 * falharia com "Cannot use a pool after calling end on the pool".
 */
let poolAtual = null;

const criarPool = () => {
    const pool = new Pool({
        connectionString: config.banco.url,
        ssl: config.banco.ssl ? { rejectUnauthorized: false } : false,
        max: config.teste ? 5 : 10,
        idleTimeoutMillis: 30000,
        // Garante que toda conexao enxergue o schema configurado (usado nos testes).
        options: `-c search_path=${config.banco.schema},public`,
    });

    pool.on('error', (erro) => {
        console.error('[db] erro inesperado no pool de conexoes:', erro.message);
    });

    return pool;
};

const obterPool = () => {
    if (!poolAtual) poolAtual = criarPool();
    return poolAtual;
};

/**
 * Executa uma query parametrizada. Nunca interpole valores diretamente no SQL.
 */
const query = (texto, parametros) => obterPool().query(texto, parametros);

/**
 * Executa a funcao recebida dentro de uma transacao, com COMMIT/ROLLBACK automatico.
 * @param {(cliente: import('pg').PoolClient) => Promise<any>} executar
 */
const transacao = async (executar) => {
    const cliente = await obterPool().connect();
    try {
        await cliente.query('BEGIN');
        const resultado = await executar(cliente);
        await cliente.query('COMMIT');
        return resultado;
    } catch (erro) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        cliente.release();
    }
};

/** Fecha o pool atual. Uma nova consulta depois disso abre outro pool. */
const encerrar = async () => {
    if (!poolAtual) return;
    const pool = poolAtual;
    poolAtual = null;
    await pool.end();
};

module.exports = {
    /** Pool ativo (criado na primeira utilizacao). */
    get pool() {
        return obterPool();
    },
    query,
    transacao,
    encerrar,
};
