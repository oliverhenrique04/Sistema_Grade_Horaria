const express = require('express');

const { montarMenu } = require('../middlewares/menu');
const { verificarCsrf } = require('../middlewares/csrf');

const dashboard = require('./admin/dashboard');
const campus = require('./admin/campus');
const turnos = require('./admin/turnos');
const horarios = require('./admin/horarios');
const cursos = require('./admin/cursos');
const periodos = require('./admin/periodos');
const turmas = require('./admin/turmas');
const disciplinas = require('./admin/disciplinas');
const professores = require('./admin/professores');
const locais = require('./admin/locais');
const usuarios = require('./admin/usuarios');
const aulas = require('./admin/aulas');
const importacao = require('./admin/importacao');

const router = express.Router();

router.use(montarMenu);

// A importacao recebe `multipart/form-data`: o corpo precisa ser interpretado
// antes de o token `_csrf` poder ser conferido, entao este router aplica a
// verificacao por conta propria, logo apos ler o arquivo. E a unica excecao — e
// ela nao afrouxa nada: sem CSRF valido, nenhuma rota de importacao responde.
router.use('/importacao', importacao);

// Todas as demais requisicoes que modificam estado exigem token CSRF valido.
router.use(verificarCsrf);

router.use('/', dashboard);
router.use('/campus', campus);
router.use('/turnos', turnos);
router.use('/horarios', horarios);
router.use('/cursos', cursos);
router.use('/periodos', periodos);
router.use('/turmas', turmas);
router.use('/disciplinas', disciplinas);
router.use('/professores', professores);
router.use('/locais', locais);
router.use('/usuarios', usuarios);
router.use('/aulas', aulas);

module.exports = router;
