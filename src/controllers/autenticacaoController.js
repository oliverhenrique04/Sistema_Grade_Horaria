/**
 * Controller de autenticacao: tela de login, criacao e encerramento de sessao.
 *
 * Nao existe mais acesso administrativo por token na URL: a unica porta de
 * entrada e `POST /login`.
 */
const config = require('../config/env');
const autenticacaoService = require('../services/autenticacaoService');
const { validarLogin } = require('../validators/autenticacao');
const { renovarToken } = require('../middlewares/csrf');
const { comBase } = require('../middlewares/autenticacao');
const { destinoInternoSeguro } = require('../middlewares/contexto');
const { ErroValidacao, ErroAutenticacao, async: assincrono } = require('../utils/erros');

const DESTINO_PADRAO = '/admin';

/**
 * Valida o parametro `proximo` mantendo-o como caminho interno (sem BASE_PATH),
 * proprio para reenviar no campo oculto do formulario.
 * Bloqueia open redirect: `https://evil.com`, `//evil.com`, `/\evil.com` etc.
 * @param {unknown} valor
 * @returns {string} caminho interno seguro ou string vazia
 */
const proximoInterno = (valor) => destinoInternoSeguro(valor, '', '');

/**
 * Monta os dados enviados a view de login.
 */
const dadosDaTela = (req, res, { erro = null, email = '', proximo = '' } = {}) => ({
    tituloPagina: 'Entrar',
    erro,
    email,
    proximo,
    csrfToken: res.locals.csrfToken || '',
});

/**
 * GET /login - formulario de acesso.
 * @type {import('express').RequestHandler}
 */
const formulario = (req, res) => {
    res.render('auth/login', dadosDaTela(req, res, { proximo: proximoInterno(req.query.proximo) }));
};

/**
 * Regenera o identificador da sessao (protecao contra session fixation).
 * @param {import('express').Request} req
 * @returns {Promise<void>}
 */
const regenerarSessao = (req) =>
    new Promise((resolver, rejeitar) => {
        req.session.regenerate((erro) => (erro ? rejeitar(erro) : resolver()));
    });

/**
 * Persiste a sessao antes de redirecionar (garante o Set-Cookie e a gravacao
 * no store, que e assincrono).
 * @param {import('express').Request} req
 * @returns {Promise<void>}
 */
const salvarSessao = (req) =>
    new Promise((resolver, rejeitar) => {
        req.session.save((erro) => (erro ? rejeitar(erro) : resolver()));
    });

/**
 * POST /login - autentica, regenera a sessao e redireciona.
 * @type {import('express').RequestHandler}
 */
const entrar = assincrono(async (req, res) => {
    const proximoSolicitado = proximoInterno(req.body.proximo);
    const emailInformado = typeof req.body.email === 'string' ? req.body.email.trim() : '';

    let credenciais;
    try {
        credenciais = validarLogin(req.body);
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        // A senha digitada nunca volta para a tela; o e-mail sim, por comodidade.
        return res.status(422).render(
            'auth/login',
            dadosDaTela(req, res, {
                erro: erro.message,
                email: emailInformado,
                proximo: proximoSolicitado,
            })
        );
    }

    let usuario;
    try {
        usuario = await autenticacaoService.autenticar(credenciais.email, credenciais.senha);
    } catch (erro) {
        if (!(erro instanceof ErroAutenticacao)) throw erro;
        return res.status(401).render(
            'auth/login',
            dadosDaTela(req, res, {
                // Mensagem generica: nao revela se o e-mail existe ou se a conta esta inativa.
                erro: erro.message,
                email: emailInformado,
                proximo: proximoSolicitado,
            })
        );
    }

    // Session fixation: descarta o identificador usado antes da autenticacao.
    await regenerarSessao(req);

    req.session.usuarioId = usuario.id;
    req.session.autenticadoEm = new Date().toISOString();
    // A sessao anterior (e o token CSRF dela) foi descartada na regeneracao.
    renovarToken(req, res);

    await salvarSessao(req);
    await autenticacaoService.registrarLogin(usuario.id);

    const padrao = comBase(req, res, DESTINO_PADRAO);
    const base = typeof req.basePath === 'string' ? req.basePath : config.basePath || '';

    return res.redirect(destinoInternoSeguro(proximoSolicitado, padrao, base));
});

/**
 * POST /logout - destroi a sessao e limpa o cookie.
 * @type {import('express').RequestHandler}
 */
const sair = (req, res, next) => {
    const finalizar = () => {
        res.clearCookie(config.sessao.nomeCookie, {
            // Precisa espelhar exatamente os atributos usados em middlewares/sessao.js,
            // senao o navegador nao remove o cookie.
            path: '/',
            httpOnly: true,
            secure: config.sessao.cookieSeguro,
            sameSite: config.sessao.sameSite,
        });
        res.redirect(comBase(req, res, '/login'));
    };

    if (!req.session) return finalizar();

    return req.session.destroy((erro) => {
        if (erro) return next(erro);
        return finalizar();
    });
};

module.exports = { formulario, entrar, sair, proximoInterno };
