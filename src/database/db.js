const { Pool } = require('pg');

const pool = new Pool({
    // Sintaxe: postgresql://usuario:senha@host:porta/banco
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:123456@127.0.0.1:5432/grade_horaria'
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};