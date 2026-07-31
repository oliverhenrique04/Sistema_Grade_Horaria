/**
 * Preparacao global da suite de testes (jest `globalSetup`).
 *
 * Derruba e recria o schema de teste (`DB_SCHEMA` do .env.test, por padrao
 * `teste_automatizado`), aplica todas as migrations e roda o seed. Roda uma
 * unica vez, antes de qualquer arquivo de teste.
 *
 * PROTECOES: aborta se NODE_ENV nao for `test` ou se o schema configurado for
 * `public`. O banco de producao nunca deve ser alcancado por esta rotina.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const config = require('../../src/config/env');
const db = require('../../src/config/db');
const { migrar } = require('../../src/database/migrate');
const seeds = require('../../src/database/seeds');

/** Nome de schema seguro para interpolar (identificador simples). */
const SCHEMA_VALIDO = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

module.exports = async () => {
    const schema = config.banco.schema;

    if (!config.teste) {
        throw new Error(
            `Os testes exigem NODE_ENV=test (ambiente atual: ${config.ambiente}). Abortando.`
        );
    }

    if (!schema || schema === 'public') {
        throw new Error(
            'DB_SCHEMA de teste nao pode ser "public": defina um schema dedicado em .env.test.'
        );
    }

    if (!SCHEMA_VALIDO.test(schema)) {
        throw new Error(`Nome de schema invalido para testes: ${schema}`);
    }

    try {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.query(`CREATE SCHEMA "${schema}"`);

        // Rede de seguranca: garante que as conexoes do pool passaram a enxergar
        // o schema de teste antes de qualquer DDL das migrations.
        const atual = await db.query('SELECT current_schema() AS schema');
        if (atual.rows[0].schema !== schema) {
            throw new Error(
                `search_path aponta para "${atual.rows[0].schema}" em vez de "${schema}". Abortando.`
            );
        }

        await migrar({ silencioso: true });
        await seeds.executar();
    } finally {
        await db.encerrar().catch(() => {});
    }
};
