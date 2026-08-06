const path = require('node:path');
const express = require('express');

const config = require('./config/env');
const { aplicarSeguranca } = require('./middlewares/seguranca');
const { criarMiddlewareSessao } = require('./middlewares/sessao');
const { gerarToken } = require('./middlewares/csrf');
const { carregarUsuario } = require('./middlewares/autenticacao');
const { contextoBase, flash } = require('./middlewares/contexto');
const { periodoLetivoAtual } = require('./middlewares/periodoLetivo');
const { naoEncontrado, tratadorGlobal } = require('./middlewares/erros');
const rotas = require('./routes');

const RAIZ = path.resolve(__dirname, '..');

/**
 * Monta a aplicacao Express. Exposta como fabrica para que os testes possam
 * criar instancias isoladas sem subir o servidor HTTP.
 */
const criarApp = () => {
    const app = express();

    // O nginx roda na mesma maquina: confiar apenas em proxies locais evita que
    // um X-Forwarded-For forjado burle o rate limit de login.
    app.set('trust proxy', 'loopback');
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.set('x-powered-by', false);

    // Permite include com caminho absoluto a partir da pasta de views.
    app.locals.basedir = path.join(__dirname, 'views');

    // Precisa vir antes de tudo: as paginas de erro usam `asset` e `withBase`, e
    // um erro dos parsers de corpo (JSON malformado, corpo grande demais) e
    // levantado antes de qualquer rota. Sem os helpers em `res.locals` o render da
    // pagina de erro falha e o Express devolve o "Bad Request" cru do finalhandler.
    // So depende de cabecalhos e configuracao — nao usa sessao nem corpo.
    app.use(contextoBase);

    // Helmet, parsers de corpo com limite de tamanho e demais protecoes.
    aplicarSeguranca(app);

    app.use(
        express.static(path.join(RAIZ, 'public'), {
            maxAge: config.producao ? '7d' : 0,
        })
    );

    app.use(criarMiddlewareSessao());
    app.use(flash);
    app.use(gerarToken);
    app.use(carregarUsuario);
    app.use(periodoLetivoAtual);

    app.use('/', rotas);

    app.use(naoEncontrado);
    app.use(tratadorGlobal);

    return app;
};

module.exports = { criarApp };
