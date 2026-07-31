/**
 * Rotas do CRUD de professores.
 *
 * Toda rota declara explicitamente a permissao exigida. Esconder o botao na view
 * e apenas conforto visual: o bloqueio real acontece aqui, no backend.
 * Coordenador e NAP so tem a acao `ler` sobre este recurso.
 */
const express = require('express');

const { exigirPermissao } = require('../../middlewares/autorizacao');
const professorController = require('../../controllers/admin/professorController');

const router = express.Router();

router.get('/', exigirPermissao('professores', 'ler'), professorController.lista);

router.get('/novo', exigirPermissao('professores', 'criar'), professorController.formularioNovo);
router.post('/', exigirPermissao('professores', 'criar'), professorController.criar);

router.get(
    '/:id/editar',
    exigirPermissao('professores', 'editar'),
    professorController.formularioEditar
);
router.post('/:id', exigirPermissao('professores', 'editar'), professorController.atualizar);

router.post(
    '/:id/status',
    exigirPermissao('professores', 'inativar'),
    professorController.alterarStatus
);
router.post(
    '/:id/excluir',
    exigirPermissao('professores', 'inativar'),
    professorController.excluir
);

module.exports = router;
