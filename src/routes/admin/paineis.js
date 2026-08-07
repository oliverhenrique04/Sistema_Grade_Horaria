/**
 * Rotas dos paineis de TV (/admin/paineis).
 *
 * Liberadas para `admin` e `nap` — e o NAP que conhece os blocos, as salas e
 * onde cada TV esta pendurada. Coordenador fica de fora: o recorte de um painel
 * e por predio e por campus, nao por curso.
 *
 * O escopo por campus e conferido no controller, painel a painel, e nao aqui:
 * ele depende do registro alvo.
 */
const express = require('express');

const controller = require('../../controllers/admin/painelController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

router.get('/', exigirPermissao('paineis', 'ler'), controller.lista);

router.get('/novo', exigirPermissao('paineis', 'criar'), controller.novo);
router.post('/', exigirPermissao('paineis', 'criar'), controller.criar);

router.get('/:id/editar', exigirPermissao('paineis', 'editar'), controller.editar);
router.post('/:id', exigirPermissao('paineis', 'editar'), controller.atualizar);

router.post('/:id/situacao', exigirPermissao('paineis', 'inativar'), controller.alterarSituacao);

module.exports = router;
