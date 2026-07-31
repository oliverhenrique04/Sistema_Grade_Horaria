const db = require('../config/db');

/**
 * Disponibiliza o periodo letivo atual para todas as views
 * (`res.locals.periodoAtual`), eliminando valores fixos como "2026.1" no HTML.
 *
 * Falhas de leitura nao devem derrubar a pagina: nesse caso o periodo fica nulo
 * e as views exibem o estado correspondente.
 */
const periodoLetivoAtual = async (req, res, next) => {
    try {
        const resultado = await db.query(
            `SELECT id, codigo, ano, semestre, data_inicio, data_fim
               FROM periodos_letivos
              WHERE atual AND ativo
              LIMIT 1`
        );
        res.locals.periodoAtual = resultado.rows[0] || null;
        req.periodoAtual = res.locals.periodoAtual;
    } catch (erro) {
        console.error('[periodo-letivo] falha ao carregar periodo atual:', erro.message);
        res.locals.periodoAtual = null;
        req.periodoAtual = null;
    }

    next();
};

module.exports = { periodoLetivoAtual };
