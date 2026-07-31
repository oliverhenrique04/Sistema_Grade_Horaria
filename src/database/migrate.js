const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/env');
const db = require('../config/db');

const DIRETORIO_MIGRATIONS = path.join(__dirname, 'migrations');

const listarArquivos = () =>
    fs
        .readdirSync(DIRETORIO_MIGRATIONS)
        .filter((arquivo) => arquivo.endsWith('.sql') || arquivo.endsWith('.js'))
        .sort();

const garantirSchema = async (cliente) => {
    if (config.banco.schema !== 'public') {
        await cliente.query(`CREATE SCHEMA IF NOT EXISTS ${JSON.stringify(config.banco.schema)}`);
        await cliente.query(`SET search_path TO ${JSON.stringify(config.banco.schema)}, public`);
    }
};

const garantirTabelaControle = async (cliente) => {
    await cliente.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL UNIQUE,
            aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

const listarAplicadas = async (cliente) => {
    const resultado = await cliente.query('SELECT nome FROM schema_migrations ORDER BY nome');
    return new Set(resultado.rows.map((linha) => linha.nome));
};

const executarMigration = async (cliente, arquivo) => {
    const caminho = path.join(DIRETORIO_MIGRATIONS, arquivo);

    if (arquivo.endsWith('.sql')) {
        const sql = fs.readFileSync(caminho, 'utf8');
        await cliente.query(sql);
        return null;
    }

    const modulo = require(caminho);
    if (typeof modulo.up !== 'function') {
        throw new Error(`Migration ${arquivo} nao exporta a funcao up(cliente).`);
    }
    return modulo.up(cliente);
};

/**
 * Aplica todas as migrations pendentes. Cada migration roda em sua propria transacao,
 * de modo que uma falha nao deixa o banco em estado parcial.
 */
const migrar = async ({ silencioso = false } = {}) => {
    const log = (mensagem) => {
        if (!silencioso) console.log(mensagem);
    };

    const cliente = await db.pool.connect();
    const resultados = [];

    try {
        await garantirSchema(cliente);
        await garantirTabelaControle(cliente);
        const aplicadas = await listarAplicadas(cliente);
        const arquivos = listarArquivos();
        const pendentes = arquivos.filter((arquivo) => !aplicadas.has(arquivo));

        if (pendentes.length === 0) {
            log('Nenhuma migration pendente.');
            return resultados;
        }

        for (const arquivo of pendentes) {
            const inicio = Date.now();
            await cliente.query('BEGIN');
            try {
                await garantirSchema(cliente);
                const detalhe = await executarMigration(cliente, arquivo);
                await cliente.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
                await cliente.query('COMMIT');
                const duracao = Date.now() - inicio;
                log(`  aplicada: ${arquivo} (${duracao}ms)`);
                resultados.push({ arquivo, detalhe });
            } catch (erro) {
                await cliente.query('ROLLBACK').catch(() => {});
                throw new Error(`Falha na migration ${arquivo}: ${erro.message}`, { cause: erro });
            }
        }

        return resultados;
    } finally {
        cliente.release();
    }
};

const status = async () => {
    const cliente = await db.pool.connect();
    try {
        await garantirSchema(cliente);
        await garantirTabelaControle(cliente);
        const aplicadas = await listarAplicadas(cliente);
        return listarArquivos().map((arquivo) => ({
            arquivo,
            aplicada: aplicadas.has(arquivo),
        }));
    } finally {
        cliente.release();
    }
};

module.exports = { migrar, status };
