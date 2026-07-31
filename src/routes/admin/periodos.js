/**
 * Rotas do CRUD de periodos letivos.
 *
 * Toda rota declara explicitamente a permissao exigida. Esconder o botao na view
 * e apenas conforto visual: o bloqueio real acontece aqui, no backend.
 * Coordenador e NAP so tem a acao `ler` sobre este recurso.
 */
const express = require('express');

const { exigirPermissao } = require('../../middlewares/autorizacao');
const periodoLetivoController = require('../../controllers/admin/periodoLetivoController');

const router = express.Router();

router.get('/', exigirPermissao('periodos', 'ler'), periodoLetivoController.lista);

router.get('/novo', exigirPermissao('periodos', 'criar'), periodoLetivoController.formularioNovo);
router.post('/', exigirPermissao('periodos', 'criar'), periodoLetivoController.criar);

router.get(
    '/:id/editar',
    exigirPermissao('periodos', 'editar'),
    periodoLetivoController.formularioEditar
);
router.post('/:id', exigirPermissao('periodos', 'editar'), periodoLetivoController.atualizar);

// Troca o periodo vigente do sistema (desmarca o anterior na mesma transacao).
router.post(
    '/:id/atual',
    exigirPermissao('periodos', 'editar'),
    periodoLetivoController.definirAtual
);

router.post(
    '/:id/status',
    exigirPermissao('periodos', 'inativar'),
    periodoLetivoController.alterarStatus
);
router.post(
    '/:id/excluir',
    exigirPermissao('periodos', 'inativar'),
    periodoLetivoController.excluir
);

module.exports = router;
