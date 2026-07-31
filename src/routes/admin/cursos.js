/**
 * Rotas do CRUD de cursos.
 *
 * Toda rota declara explicitamente a permissao exigida. Esconder o botao na view
 * e apenas conforto visual: o bloqueio real acontece aqui, no backend.
 * Coordenador e NAP so tem a acao `ler` sobre este recurso.
 */
const express = require('express');

const { exigirPermissao } = require('../../middlewares/autorizacao');
const cursoController = require('../../controllers/admin/cursoController');

const router = express.Router();

router.get('/', exigirPermissao('cursos', 'ler'), cursoController.lista);

router.get('/novo', exigirPermissao('cursos', 'criar'), cursoController.formularioNovo);
router.post('/', exigirPermissao('cursos', 'criar'), cursoController.criar);

router.get('/:id/editar', exigirPermissao('cursos', 'editar'), cursoController.formularioEditar);
router.post('/:id', exigirPermissao('cursos', 'editar'), cursoController.atualizar);

router.post('/:id/status', exigirPermissao('cursos', 'inativar'), cursoController.alterarStatus);
router.post('/:id/excluir', exigirPermissao('cursos', 'inativar'), cursoController.excluir);

module.exports = router;
