/**
 * Rotas de locais (/admin/locais).
 *
 * A matriz de permissoes libera o perfil `nap` a manter locais; o recorte por
 * campus (somente os campus vinculados ao usuario) e aplicado no servico.
 */
const express = require('express');

const controller = require('../../controllers/admin/localController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

router.get('/', exigirPermissao('locais', 'ler'), controller.lista);

router.get('/novo', exigirPermissao('locais', 'criar'), controller.novo);
router.post('/', exigirPermissao('locais', 'criar'), controller.criar);

router.get('/:id/editar', exigirPermissao('locais', 'editar'), controller.editar);
router.post('/:id', exigirPermissao('locais', 'editar'), controller.atualizar);

router.post('/:id/situacao', exigirPermissao('locais', 'inativar'), controller.alterarSituacao);
router.post('/:id/excluir', exigirPermissao('locais', 'inativar'), controller.excluir);

module.exports = router;
