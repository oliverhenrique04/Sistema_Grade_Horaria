/**
 * Rotas do CRUD de disciplinas.
 *
 * Toda rota declara explicitamente a permissao exigida. Esconder o botao na view
 * e apenas conforto visual: o bloqueio real acontece aqui, no backend.
 * Coordenador e NAP so tem a acao `ler` sobre este recurso.
 */
const express = require('express');

const { exigirPermissao } = require('../../middlewares/autorizacao');
const disciplinaController = require('../../controllers/admin/disciplinaController');

const router = express.Router();

router.get('/', exigirPermissao('disciplinas', 'ler'), disciplinaController.lista);

router.get('/nova', exigirPermissao('disciplinas', 'criar'), disciplinaController.formularioNovo);
router.post('/', exigirPermissao('disciplinas', 'criar'), disciplinaController.criar);

router.get(
    '/:id/editar',
    exigirPermissao('disciplinas', 'editar'),
    disciplinaController.formularioEditar
);
router.post('/:id', exigirPermissao('disciplinas', 'editar'), disciplinaController.atualizar);

router.post(
    '/:id/status',
    exigirPermissao('disciplinas', 'inativar'),
    disciplinaController.alterarStatus
);
router.post(
    '/:id/excluir',
    exigirPermissao('disciplinas', 'inativar'),
    disciplinaController.excluir
);

module.exports = router;
