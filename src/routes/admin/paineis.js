/**
 * Rotas do gerador de links das TVs dos blocos (/admin/paineis).
 *
 * Somente leitura: a tela monta um endereco, nao grava registro. Liberada para
 * `admin` e `nap` — e o NAP que conhece os blocos, as salas e onde cada TV
 * esta pendurada. Coordenador fica de fora: o recorte e por predio e por
 * campus, nao por curso.
 */
const express = require('express');

const controller = require('../../controllers/admin/painelController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

router.get('/', exigirPermissao('paineis', 'ler'), controller.gerador);

module.exports = router;
