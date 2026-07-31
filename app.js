const config = require('./src/config/env');
const db = require('./src/config/db');
const { criarApp } = require('./src/app');

const app = criarApp();

const servidor = app.listen(config.porta, () => {
    console.log(`Servidor rodando em modo ${config.ambiente} na porta ${config.porta}`);
    console.log(`Área pública:  http://localhost:${config.porta}${config.basePath || ''}/`);
    console.log(`Painel admin:  http://localhost:${config.porta}${config.basePath || ''}/admin`);
});

const encerrar = (sinal) => {
    console.log(`\nRecebido ${sinal}, encerrando...`);

    servidor.close(async () => {
        await db.encerrar().catch(() => {});
        process.exit(0);
    });

    // Failsafe: nao deixa o processo pendurado indefinidamente.
    setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));

module.exports = app;
