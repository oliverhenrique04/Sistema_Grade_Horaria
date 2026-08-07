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
const rotaPainel = require('./routes/painel');

const RAIZ = path.resolve(__dirname, '..');

/**
 * O arquivo estatico pertence ao painel de corredor?
 *
 * Só esses recebem `Cross-Origin-Resource-Policy: cross-origin`; o restante de
 * `public/` continua `same-site`, como o helmet define.
 *
 * @param {string} arquivo caminho absoluto do arquivo servido
 * @returns {boolean}
 */
const ehRecursoDoPainel = (arquivo) =>
    /painel\.(css|js)$/.test(arquivo) || arquivo.includes(`${path.sep}fontes${path.sep}`);

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
            setHeaders: (res, arquivo) => {
                // Os recursos do painel viajam para dentro do iframe do
                // aplicativo de sinalizacao da TV, cuja origem e outra — e
                // opaca, quando o iframe e `sandbox` sem `allow-same-origin`.
                // Com o `same-site` do helmet o Chrome recusa CSS e JS com
                // ERR_BLOCKED_BY_RESPONSE.NotSameSite e a TV mostra a pagina
                // crua: sem estilo e sem relogio.
                //
                // Liberar o HTML nao basta, e foi esse o erro: cada subrecurso
                // e verificado por conta propria.
                if (ehRecursoDoPainel(arquivo)) {
                    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
                }
            },
        })
    );

    // Antes da sessao, de proposito: o painel das TVs e publico, nao tem
    // formulario e nao guarda nada entre requisicoes. Passando pela sessao, o
    // middleware de CSRF gravaria um token a cada pedido e criaria uma linha em
    // `session` por recarga — uma por minuto, por TV. So depende de
    // `contextoBase` (asset/withBase), que ja rodou.
    app.use('/', rotaPainel);

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
