/**
 * Rotas da area publica de consulta da grade horaria.
 *
 * Montadas na raiz da aplicacao (ver src/routes/index.js). Nao exigem sessao,
 * nao recebem POST e nao expoem nenhuma acao administrativa.
 */
const express = require('express');

const publicoController = require('../controllers/publicoController');

const router = express.Router();

// Consulta com filtros encadeados na query string.
router.get('/', publicoController.consultar);

// Mesma grade em layout de impressao (sem filtros nem navegacao).
router.get('/imprimir', publicoController.imprimir);

// O painel de corredor (/painel) NAO mora aqui: e montado antes da sessao,
// em src/app.js. Ver src/routes/painel.js.

module.exports = router;
