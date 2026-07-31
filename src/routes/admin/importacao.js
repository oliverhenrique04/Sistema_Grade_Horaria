/**
 * Rotas da importacao de grade (`/admin/importacao`).
 *
 * ORDEM DOS MIDDLEWARES (nao reordene): o formulario envia a planilha como
 * `multipart/form-data`, formato que os parsers globais do Express nao leem.
 * `receberArquivo` interpreta o corpo e preenche `req.body`; so depois disso o
 * token `_csrf` existe para ser conferido. Por isso este router aplica o CSRF
 * por conta propria — e o unico do painel registrado antes da verificacao
 * global, exatamente por causa disso (ver `routes/admin.js`).
 *
 * Importar altera a base inteira: exige perfil de administrador, alem da
 * permissao do recurso.
 */
const express = require('express');

const { async: envolver } = require('../../utils/erros');
const { exigirPermissao, exigirPerfil } = require('../../middlewares/autorizacao');
const { verificarCsrf } = require('../../middlewares/csrf');
const { receberArquivo } = require('../../middlewares/upload');
const config = require('../../config/env');
const importacaoController = require('../../controllers/admin/importacaoController');

const router = express.Router();

// O perfil e conferido ANTES de ler o corpo: quem nao pode importar tambem nao
// deve fazer o servidor bufferizar uma planilha inteira na memoria.
router.use(exigirPerfil('admin'));
router.use(
    receberArquivo({ campo: 'arquivo', limiteBytes: config.limiteUpload, extensoes: ['.xlsx'] })
);
router.use(verificarCsrf);

router.get('/', exigirPermissao('importacao', 'ler'), envolver(importacaoController.inicio));

router.post('/', exigirPermissao('importacao', 'criar'), envolver(importacaoController.analisar));

router.post(
    '/:envio/aplicar',
    exigirPermissao('importacao', 'criar'),
    envolver(importacaoController.aplicar)
);

router.post(
    '/:envio/descartar',
    exigirPermissao('importacao', 'criar'),
    envolver(importacaoController.descartar)
);

module.exports = router;
