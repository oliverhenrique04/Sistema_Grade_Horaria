const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');
const adminController = require('../controllers/adminController');

// --- PÁGINA PÚBLICA ---
router.get('/', publicController.getGradePage);

// --- ÁREA ADMIN (CRUDs) ---
router.get('/admin', adminController.getDashboard);

// ROTAS ESPECÍFICAS PARA MONTAR A GRADE (Relacionamentos)
router.get('/admin/turmas/:id/grade', adminController.montarGrade);
router.post('/admin/turmas/:id/grade/salvar', adminController.adicionarItemGrade);
router.get('/admin/turmas/:id/grade/remover/:id_item', adminController.removerItemGrade);
// Rota genérica para exclusão
router.post('/admin/:entidade/excluir/:id', adminController.excluir);

module.exports = router;
// Rotas dinâmicas para CRUDs (Ex: /admin/professores, /admin/cursos)
router.get('/admin/:entidade', adminController.listar);
router.get('/admin/:entidade/novo', adminController.formCriar);
router.post('/admin/:entidade/salvar', adminController.criar);

module.exports = router;