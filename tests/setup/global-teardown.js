/**
 * Encerramento global da suite (jest `globalTeardown`).
 *
 * O pool ja e fechado no final do `global-setup`; este encerramento e apenas
 * uma rede de seguranca para nao deixar conexoes abertas caso algo tenha
 * reaberto o pool no processo principal do Jest.
 */
const db = require('../../src/config/db');

module.exports = async () => {
    try {
        await db.encerrar();
    } catch {
        // Pool ja encerrado: nada a fazer.
    }
};
