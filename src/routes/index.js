const express = require('express');

const rotasPublicas = require('./publico');
const rotasAutenticacao = require('./autenticacao');
const rotasAdmin = require('./admin');
const { exigirLogin } = require('../middlewares/autenticacao');

const router = express.Router();

// Login e logout ficam na raiz (GET /login, POST /login, POST /logout).
router.use('/', rotasAutenticacao);

// Painel administrativo: toda a arvore exige sessao autenticada.
router.use('/admin', exigirLogin, rotasAdmin);

// Consulta publica da grade horaria.
router.use('/', rotasPublicas);

module.exports = router;
