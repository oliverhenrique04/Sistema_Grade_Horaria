/**
 * Rotas dos horarios dos turnos (/admin/horarios).
 */
const express = require('express');

const controller = require('../../controllers/admin/horarioController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

router.get('/', exigirPermissao('horarios', 'ler'), controller.lista);

router.get('/novo', exigirPermissao('horarios', 'criar'), controller.novo);
router.post('/', exigirPermissao('horarios', 'criar'), controller.criar);

router.get('/:id/editar', exigirPermissao('horarios', 'editar'), controller.editar);
router.post('/:id', exigirPermissao('horarios', 'editar'), controller.atualizar);

router.post('/:id/situacao', exigirPermissao('horarios', 'inativar'), controller.alterarSituacao);
router.post('/:id/excluir', exigirPermissao('horarios', 'inativar'), controller.excluir);

module.exports = router;
