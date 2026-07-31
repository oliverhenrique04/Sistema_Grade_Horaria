/**
 * Rotas de aulas (/admin/aulas) — listagem e montador da grade horaria.
 *
 * Toda rota declara a permissao exigida: a verificacao acontece no backend,
 * esconder o botao na view e apenas conforto visual. As restricoes que dependem
 * do registro alvo (escopo de curso/campus e os campos que o perfil NAP pode
 * alterar) sao aplicadas no controller.
 *
 * Ordem importa: `/prever`, `/lote` e `/turma` sao caminhos fixos e precisam ser
 * declarados antes das rotas com parametro (`/:id`), senao seriam capturados
 * por elas.
 */
const express = require('express');

const controller = require('../../controllers/admin/aulaController');
const { exigirPermissao } = require('../../middlewares/autorizacao');

const router = express.Router();

// Consultas -----------------------------------------------------------------
router.get('/', exigirPermissao('aulas', 'ler'), controller.lista);
router.get('/turma', exigirPermissao('aulas', 'ler'), controller.selecionarTurma);
router.get('/turma/:turmaId', exigirPermissao('aulas', 'ler'), controller.montador);

// Pre-visualizacao de conflitos: nao grava nada, por isso exige apenas leitura
// (o perfil NAP tambem precisa conferir o impacto antes de trocar um local).
router.post('/prever', exigirPermissao('aulas', 'ler'), controller.prever);

// Gravacao ------------------------------------------------------------------
router.post('/lote', exigirPermissao('aulas', 'criar'), controller.criarEmLote);
router.post('/', exigirPermissao('aulas', 'criar'), controller.criar);

// Alocacao de sala em lote: alterar local e operacao do dia a dia, liberada
// para os mesmos perfis que editam aula (inclusive o nap).
router.post(
    '/turma/:turmaId/local',
    exigirPermissao('aulas', 'editar'),
    controller.definirLocalEmLote
);

router.post('/:id', exigirPermissao('aulas', 'editar'), controller.atualizar);
router.post('/:id/mover', exigirPermissao('aulas', 'editar'), controller.mover);
router.post('/:id/copiar', exigirPermissao('aulas', 'criar'), controller.copiar);

router.post('/:id/inativar', exigirPermissao('aulas', 'inativar'), controller.inativar);
router.post('/:id/reativar', exigirPermissao('aulas', 'inativar'), controller.reativar);
router.post('/:id/remover', exigirPermissao('aulas', 'inativar'), controller.remover);

module.exports = router;
