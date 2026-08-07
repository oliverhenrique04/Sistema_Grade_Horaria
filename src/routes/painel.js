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
const { permitirEmbutir } = require('../middlewares/seguranca');

const router = express.Router();

// O recorte vem na URL; a faixa do dia vem do relogio do servidor, todo dia,
// sem ninguem tocar na TV.
//
// `permitirEmbutir` so vale aqui: os aplicativos de sinalizacao das TVs
// mostram a pagina dentro de um iframe da propria casca, de outra origem, e
// sem isso o Chrome recusa a resposta com ERR_BLOCKED_BY_RESPONSE.
router.get('/painel', permitirEmbutir, painelController.exibir);

// Painel salvo. E o caminho preferido: o recorte mora no banco, e corrigir uma
// TV nao exige chegar ate ela. A rota acima continua valendo porque ja ha
// aparelho em producao configurado com o recorte na propria URL.
router.get('/painel/:slug', permitirEmbutir, painelController.exibirSalvo);

module.exports = router;
