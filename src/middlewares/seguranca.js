/**
 * Endurecimento HTTP: cabecalhos de seguranca (helmet), limites de payload e
 * limitacao de tentativas de login.
 */
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

/** Origens externas usadas pelo front (Bootstrap 5, FontAwesome, Google Fonts). */
const CDN_SCRIPTS = ['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'];
const CDN_ESTILOS = [
    'https://cdn.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
    'https://fonts.googleapis.com',
];
const CDN_FONTES = ['https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'];

/**
 * Politica de seguranca de conteudo compativel com o front atual.
 *
 * Trade-off consciente: `'unsafe-inline'` e permitido em `style-src` e
 * `script-src` porque as views existentes usam atributos `style=` e blocos
 * `<script>` inline. Isso reduz a protecao contra XSS refletido. A evolucao
 * desejada e mover o JS/CSS inline para arquivos em /public e trocar
 * `'unsafe-inline'` por nonce/hash. Enquanto isso, a defesa contra XSS depende
 * do escape automatico do EJS (`<%= %>`) — nunca use `<%- %>` com dado vindo
 * do usuario.
 */
const diretivasCsp = (seguro) => ({
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", ...CDN_SCRIPTS],
    scriptSrcAttr: ["'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", ...CDN_ESTILOS],
    styleSrcAttr: ["'unsafe-inline'"],
    fontSrc: ["'self'", ...CDN_FONTES],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    upgradeInsecureRequests: seguro ? [] : null,
});

/**
 * CSP e HSTS decididos POR REQUISICAO, e nao pelo ambiente.
 *
 * A aplicacao precisa atender o mesmo conteudo por http e por https: as TVs dos
 * blocos costumam alcancar o servidor por um endereco interno sem TLS, enquanto
 * o publico entra pelo endereco publico com TLS. Dois cabecalhos quebram esse
 * arranjo quando emitidos as cegas numa resposta http:
 *
 * - `upgrade-insecure-requests` faz o navegador reescrever para https TODOS os
 *   pedidos da pagina, inclusive o CSS, o JS e as fontes do proprio servidor.
 *   Numa TV que chegou por http o painel apareceria sem folha de estilo.
 * - `Strict-Transport-Security` fixa https para o host inteiro pelos proximos
 *   meses. Basta a TV abrir uma vez por https para nunca mais conseguir http.
 *   (O navegador ignora HSTS recebido por http, mas nao ha por que emiti-lo.)
 *
 * `req.secure` respeita o `trust proxy`: atras do nginx ele reflete o
 * `X-Forwarded-Proto` real, e nao a conexao local em texto claro.
 */
const cspPorEsquema = () => {
    const comUpgrade = helmet.contentSecurityPolicy({
        useDefaults: true,
        directives: diretivasCsp(true),
    });
    const semUpgrade = helmet.contentSecurityPolicy({
        useDefaults: true,
        directives: diretivasCsp(false),
    });

    return (req, res, next) => (req.secure ? comUpgrade : semUpgrade)(req, res, next);
};

const hstsPorEsquema = () => {
    const hsts = helmet.hsts();
    return (req, res, next) => (req.secure ? hsts(req, res, next) : next());
};

/**
 * Libera o embutimento da pagina em iframe de outra origem.
 *
 * Os aplicativos de sinalizacao das TVs nao abrem a URL como pagina: eles a
 * embutem num iframe dentro da propria casca, que e de outra origem. Com
 * `frame-ancestors 'self'` e `X-Frame-Options: SAMEORIGIN` o Chrome recusa a
 * resposta inteira e a TV mostra `ERR_BLOCKED_BY_RESPONSE`.
 *
 * Afrouxar isso e seguro NESTA pagina, e so nela: o painel e publico, nao
 * emite cookie, nao tem formulario e nao tem nada em que clicar. A protecao
 * contra clickjacking existe para impedir que um site hostil induza um clique
 * autenticado — aqui nao ha sessao nem clique, e o conteudo ja esta aberto na
 * consulta publica. Login e /admin continuam com os cabecalhos estritos.
 *
 * Aplique DEPOIS de `cspPorEsquema`, que e quem monta o cabecalho reescrito
 * aqui.
 *
 * @type {import('express').RequestHandler}
 */
const permitirEmbutir = (req, res, next) => {
    res.removeHeader('X-Frame-Options');

    // A CSP inteira sai, e nao so o `frame-ancestors`.
    //
    // Esta pagina existe para ser consumida por um player de sinalizacao de
    // terceiros, que costuma injetar script proprio na pagina para controlar
    // rodizio, escala e telemetria. Um `script-src 'self'` bloqueia essa
    // injecao e o player desiste da pagina — foi comparando com uma pagina que
    // funciona no mesmo aparelho (g1.globo.com, que manda apenas
    // `upgrade-insecure-requests`) que a diferenca apareceu.
    //
    // O que se perde aqui e pequeno: o painel nao tem formulario, nao tem
    // sessao e todo o texto sai por `<%= %>`, que o EJS escapa. Login, /admin
    // e a consulta publica seguem com a politica inteira.
    res.removeHeader('Content-Security-Policy');

    // A casca do aplicativo e de outra origem: sem isso o recurso e recusado
    // quando ele o busca, e a janela que o abriu fica isolada dele.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');

    // Endurecimentos que so fazem sentido numa pagina de aplicacao e que um
    // player embutido pode nao esperar. Nenhum deles protege nada aqui.
    [
        'Origin-Agent-Cluster',
        'Referrer-Policy',
        'X-Download-Options',
        'X-DNS-Prefetch-Control',
        'X-Permitted-Cross-Domain-Policies',
    ].forEach((cabecalho) => res.removeHeader(cabecalho));

    next();
};

/**
 * Aplica helmet e os parsers de body com limite de tamanho.
 * Deve ser chamado antes da sessao e das rotas.
 * @param {import('express').Express} app
 */
const aplicarSeguranca = (app) => {
    app.use(
        helmet({
            // Os dois abaixo dependem do esquema da requisicao; ver `cspPorEsquema`.
            contentSecurityPolicy: false,
            hsts: false,
            crossOriginEmbedderPolicy: false,
            crossOriginResourcePolicy: { policy: 'same-site' },
            referrerPolicy: { policy: 'same-origin' },
        })
    );

    app.use(cspPorEsquema());
    if (config.producao) app.use(hstsPorEsquema());

    // Formularios: `extended: false` evita objetos aninhados vindos da query string.
    app.use(express.urlencoded({ extended: false, limit: config.limitePayload }));
    app.use(express.json({ limit: config.limitePayload }));
};

const MENSAGEM_LIMITE =
    'Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.';

/**
 * Limita tentativas de login por IP. Desativado no ambiente de teste.
 * @type {import('express').RequestHandler}
 */
const limitadorLogin = rateLimit({
    windowMs: config.login.janelaMinutos * 60 * 1000,
    limit: config.login.limite,
    standardHeaders: true,
    legacyHeaders: false,
    message: MENSAGEM_LIMITE,
    skip: () => config.teste,
    // O app usa `trust proxy` porque roda atras de nginx; a validacao do
    // express-rate-limit apenas alertaria sobre isso a cada requisicao.
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (req, res) => {
        const dados = {
            tituloPagina: 'Entrar',
            erro: MENSAGEM_LIMITE,
            email: req.body && typeof req.body.email === 'string' ? req.body.email : '',
            proximo: req.body && typeof req.body.proximo === 'string' ? req.body.proximo : '',
            csrfToken: res.locals.csrfToken || (req.session && req.session.csrfToken) || '',
        };

        res.status(429).render('auth/login', dados, (erro, html) => {
            if (erro) return res.status(429).type('text/plain').send(MENSAGEM_LIMITE);
            return res.send(html);
        });
    },
});

module.exports = {
    aplicarSeguranca,
    limitadorLogin,
    diretivasCsp,
    cspPorEsquema,
    hstsPorEsquema,
    permitirEmbutir,
    MENSAGEM_LIMITE,
};
