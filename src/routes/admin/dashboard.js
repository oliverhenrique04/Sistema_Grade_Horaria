/**
 * Rotas do painel (dashboard). Montado na raiz de `/admin`:
 *
 *     router.use('/', require('./admin/dashboard'));
 *
 * A sessao ja foi exigida em `routes/index.js`; aqui verificamos a permissao de
 * leitura do recurso `dashboard`.
 */
const express = require('express');

const controller = require('../../controllers/admin/dashboardController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

router.get('/', exigirPermissao('dashboard', 'ler'), controller.exibir);

module.exports = router;
