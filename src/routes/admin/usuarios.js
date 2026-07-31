/**
 * Rotas de usuarios (`/admin/usuarios`).
 *
 * AREA EXCLUSIVA DO PERFIL `admin`: `exigirPerfil('admin')` protege a arvore
 * inteira e cada rota ainda confere a acao correspondente na matriz de
 * permissoes. Coordenador e nap recebem 403 em qualquer verbo/caminho daqui.
 *
 * Todo POST passa pela verificacao de CSRF aplicada em `routes/admin.js`.
 */
const express = require('express');

const { async: envolver } = require('../../utils/erros');
const { exigirPerfil, exigirPermissao } = require('../../middlewares/autorizacao');
const usuarioController = require('../../controllers/admin/usuarioController');

const router = express.Router();

// Primeira barreira: nenhum outro perfil passa daqui, em nenhuma rota.
router.use(exigirPerfil('admin'));

router.get('/', exigirPermissao('usuarios', 'ler'), envolver(usuarioController.lista));

router.get(
    '/novo',
    exigirPermissao('usuarios', 'criar'),
    envolver(usuarioController.formularioNovo)
);
router.post('/', exigirPermissao('usuarios', 'criar'), envolver(usuarioController.criar));

router.get(
    '/:id/editar',
    exigirPermissao('usuarios', 'editar'),
    envolver(usuarioController.formularioEdicao)
);
router.post('/:id', exigirPermissao('usuarios', 'editar'), envolver(usuarioController.atualizar));

router.post(
    '/:id/senha',
    exigirPermissao('usuarios', 'editar'),
    envolver(usuarioController.redefinirSenha)
);

router.post(
    '/:id/status',
    exigirPermissao('usuarios', 'inativar'),
    envolver(usuarioController.alterarStatus)
);
router.post(
    '/:id/excluir',
    exigirPermissao('usuarios', 'inativar'),
    envolver(usuarioController.excluir)
);

module.exports = router;
