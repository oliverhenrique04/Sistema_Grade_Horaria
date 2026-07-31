/**
 * Rotas de autenticacao. Deve ser montado na raiz:
 *
 *     router.use('/', require('./autenticacao'));
 *
 * Rotas expostas:
 *   GET  /login   formulario de acesso
 *   POST /login   autentica, regenera a sessao e redireciona
 *   POST /logout  encerra a sessao
 *
 * Os middlewares de sessao, parsers de body e `carregarUsuario` sao aplicados
 * globalmente pelo app. `gerarToken` e `verificarCsrf` sao aplicados tambem
 * aqui para que o fluxo de login continue protegido mesmo que a ordem global
 * mude (aplicar duas vezes e inofensivo).
 */
const express = require('express');
const controller = require('../controllers/autenticacaoController');
const { bloquearAutenticado } = require('../middlewares/autenticacao');
const { gerarToken, verificarCsrf } = require('../middlewares/csrf');
const { limitadorLogin } = require('../middlewares/seguranca');

const router = express.Router();

router.get('/login', gerarToken, bloquearAutenticado, controller.formulario);

router.post('/login', limitadorLogin, gerarToken, verificarCsrf, controller.entrar);

router.post('/logout', verificarCsrf, controller.sair);

module.exports = router;
