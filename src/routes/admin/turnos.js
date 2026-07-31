/**
 * Rotas de turnos (/admin/turnos).
 */
const express = require('express');

const controller = require('../../controllers/admin/turnoController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

router.get('/', exigirPermissao('turnos', 'ler'), controller.lista);

router.get('/novo', exigirPermissao('turnos', 'criar'), controller.novo);
router.post('/', exigirPermissao('turnos', 'criar'), controller.criar);

router.get('/:id/editar', exigirPermissao('turnos', 'editar'), controller.editar);
router.post('/:id', exigirPermissao('turnos', 'editar'), controller.atualizar);

router.post('/:id/situacao', exigirPermissao('turnos', 'inativar'), controller.alterarSituacao);
router.post('/:id/excluir', exigirPermissao('turnos', 'inativar'), controller.excluir);

module.exports = router;
