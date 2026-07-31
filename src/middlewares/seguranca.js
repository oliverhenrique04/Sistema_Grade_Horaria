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
const diretivasCsp = () => ({
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
    // Em desenvolvimento a aplicacao roda em http; forcar https quebraria os assets.
    upgradeInsecureRequests: config.producao ? [] : null,
});

/**
 * Aplica helmet e os parsers de body com limite de tamanho.
 * Deve ser chamado antes da sessao e das rotas.
 * @param {import('express').Express} app
 */
const aplicarSeguranca = (app) => {
    app.use(
        helmet({
            contentSecurityPolicy: { useDefaults: true, directives: diretivasCsp() },
            // HSTS so faz sentido quando a aplicacao e servida por https.
            hsts: config.producao ? undefined : false,
            crossOriginEmbedderPolicy: false,
            crossOriginResourcePolicy: { policy: 'same-site' },
            referrerPolicy: { policy: 'same-origin' },
        })
    );

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

module.exports = { aplicarSeguranca, limitadorLogin, MENSAGEM_LIMITE };
