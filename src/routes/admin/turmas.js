/**
 * Rotas de turmas (`/admin/turmas`).
 *
 * Autorizacao em duas camadas:
 *  1. matriz de permissoes (`exigirPermissao`) — o nap so tem `ler` em turmas,
 *     portanto nao chega as rotas de criacao/edicao;
 *  2. escopo do registro (`turmaService`) — o coordenador so enxerga e edita
 *     turmas dos cursos vinculados; o nap so enxerga turmas dos seus campus.
 *
 * O metodo HTTP e sempre GET ou POST (formularios HTML). Todo POST passa pela
 * verificacao de CSRF aplicada em `routes/admin.js`.
 */
const express = require('express');

const { async: envolver } = require('../../utils/erros');
const { exigirPermissao } = require('../../middlewares/autorizacao');
const turmaController = require('../../controllers/admin/turmaController');

const router = express.Router();

router.get('/', exigirPermissao('turmas', 'ler'), envolver(turmaController.lista));

router.get('/novo', exigirPermissao('turmas', 'criar'), envolver(turmaController.formularioNovo));
router.post('/', exigirPermissao('turmas', 'criar'), envolver(turmaController.criar));

router.get(
    '/:id/editar',
    exigirPermissao('turmas', 'editar'),
    envolver(turmaController.formularioEdicao)
);
router.post('/:id', exigirPermissao('turmas', 'editar'), envolver(turmaController.atualizar));

router.post(
    '/:id/status',
    exigirPermissao('turmas', 'inativar'),
    envolver(turmaController.alterarStatus)
);
router.post(
    '/:id/excluir',
    exigirPermissao('turmas', 'inativar'),
    envolver(turmaController.excluir)
);

module.exports = router;
