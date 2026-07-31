/**
 * Rotas de campus (/admin/campus).
 *
 * Toda rota declara a permissao exigida: a verificacao acontece no backend,
 * esconder o botao na view e apenas conforto visual.
 */
const express = require('express');

const controller = require('../../controllers/admin/campusController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

router.get('/', exigirPermissao('campus', 'ler'), controller.lista);

router.get('/novo', exigirPermissao('campus', 'criar'), controller.novo);
router.post('/', exigirPermissao('campus', 'criar'), controller.criar);

router.get('/:id/editar', exigirPermissao('campus', 'editar'), controller.editar);
router.post('/:id', exigirPermissao('campus', 'editar'), controller.atualizar);

router.post('/:id/situacao', exigirPermissao('campus', 'inativar'), controller.alterarSituacao);
router.post('/:id/excluir', exigirPermissao('campus', 'inativar'), controller.excluir);

module.exports = router;
