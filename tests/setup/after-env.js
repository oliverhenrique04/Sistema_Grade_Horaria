/**
 * Encerramento por arquivo de teste (jest `setupFilesAfterEnv`).
 *
 * O `globalTeardown` roda em outro contexto e nao alcanca o pool aberto dentro
 * do worker que executa os testes. Sem este afterAll o Jest reclama de handles
 * abertos ("did not exit one second after the test run") ao final da suite.
 */
const db = require('../../src/config/db');

afterAll(async () => {
    await db.encerrar().catch(() => {});
});
