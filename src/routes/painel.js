/**
 * Rota do painel de corredor (TVs dos blocos).
 *
 * Fica separada das demais rotas publicas porque e montada ANTES da sessao
 * (ver src/app.js). O painel nao tem formulario, nao tem login e nao guarda
 * nada entre requisicoes: sem essa separacao, o middleware de CSRF gravaria um
 * token na sessao a cada pedido e criaria uma linha em `session` por recarga.
 * Numa TV que recarrega a cada 60 s isso e uma sessao nova por minuto — e
 * quando o painel e servido por http em producao o cookie `secure` nem chega a
 * ser guardado, entao a linha nunca e reaproveitada.
 */
const express = require('express');

const painelController = require('../controllers/painelController');

const router = express.Router();

// O recorte vem na URL; a faixa do dia vem do relogio do servidor, todo dia,
// sem ninguem tocar na TV.
router.get('/painel', painelController.exibir);

module.exports = router;
