require('dotenv').config();

const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('Variável de ambiente DATABASE_URL não definida.');
}

const sslHabilitado = process.env.DB_SSL === 'true';

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslHabilitado ? { rejectUnauthorized: false } : false,
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
};
