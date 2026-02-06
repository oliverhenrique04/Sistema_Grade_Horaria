const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');
const adminController = require('../controllers/adminController');

// --- ÁREA PÚBLICA ---
router.get('/', publicController.getGradePage);

// --- ÁREA ADMIN ---
router.get('/admin', (req, res) => res.render('admin/dashboard'));

// Listagem (Com filtros no controller)
router.get('/admin/:entidade', adminController.listar);

// Criação
router.get('/admin/:entidade/novo', adminController.formCriar);
router.post('/admin/:entidade/salvar', adminController.salvar);

// Edição
router.get('/admin/:entidade/editar/:id', adminController.formEditar);
router.post('/admin/:entidade/atualizar/:id', adminController.atualizar);

// Exclusão
router.post('/admin/:entidade/excluir/:id', adminController.excluir);

// --- ROTAS DA GRADE ---
router.get('/admin/turmas/:id/grade', adminController.montarGrade);
router.post('/admin/turmas/:id/grade/salvar', adminController.adicionarItemGrade);
router.get('/admin/turmas/:id/grade/remover/:id_item', adminController.removerItemGrade);

// ROTA ESPECIAL NAP (Salvar Sala)
router.post('/admin/turmas/:id/grade/item/:id_item/sala', adminController.atualizarSalaGrade);

module.exports = router;