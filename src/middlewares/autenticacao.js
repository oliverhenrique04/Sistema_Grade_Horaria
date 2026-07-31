/**
 * Autenticacao baseada em sessao.
 *
 * NAO existe mais autenticacao por token na URL. O acesso administrativo exige
 * sessao valida criada em `POST /login`.
 *
 * `req.usuario` (e `res.locals.usuarioLogado`, o mesmo objeto) tem o formato:
 *   { id, nome, email, perfil, ativo, cursosIds: number[], campusIds: number[] }
 */
const usuarioRepository = require('../repositories/usuarioRepository');
const { ErroAutenticacao } = require('../utils/erros');
const config = require('../config/env');

/**
 * Monta uma URL interna respeitando o BASE_PATH.
 * Usa o helper `withBase` publicado por `middlewares/contexto.js`; o calculo
 * manual e apenas rede de seguranca para uso fora do pipeline padrao (testes
 * unitarios, por exemplo).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} destino caminho interno iniciado por '/'
 * @returns {string}
 */
const comBase = (req, res, destino) => {
    if (req && typeof req.withBase === 'function') return req.withBase(destino);
    if (res && res.locals && typeof res.locals.withBase === 'function') {
        return res.locals.withBase(destino);
    }
    const caminho = destino.startsWith('/') ? destino : `/${destino}`;
    const prefixo = req && typeof req.basePath === 'string' ? req.basePath : config.basePath || '';
    return `${prefixo}${caminho}`;
};

/**
 * Detecta requisicoes que esperam JSON (fetch/XHR), para responder 401 em vez
 * de redirecionar para a tela de login.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
const esperaJson = (req) => {
    if (req.xhr) return true;
    if (String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest')
        return true;
    const aceita = String(req.headers.accept || '');
    return aceita.includes('application/json') && !aceita.includes('text/html');
};

/**
 * Encerra a sessao atual sem propagar erros do store.
 * @param {import('express').Request} req
 * @returns {Promise<void>}
 */
const destruirSessao = (req) =>
    new Promise((resolver) => {
        if (!req.session || typeof req.session.destroy !== 'function') return resolver();
        req.session.destroy(() => resolver());
    });

/**
 * Carrega o usuario da sessao em `req.usuario` e `res.locals.usuarioLogado`.
 * Nao bloqueia a requisicao: rotas publicas continuam funcionando sem sessao.
 * Sessoes apontando para usuario inexistente ou inativo sao descartadas.
 * @type {import('express').RequestHandler}
 */
const carregarUsuario = async (req, res, next) => {
    req.usuario = null;
    res.locals.usuarioLogado = null;

    const usuarioId = req.session ? req.session.usuarioId : null;
    if (!usuarioId) return next();

    try {
        const usuario = await usuarioRepository.buscarPorId(usuarioId);

        if (!usuario || usuario.ativo === false) {
            // Usuario removido ou inativado enquanto a sessao estava aberta.
            await destruirSessao(req);
            return next();
        }

        req.usuario = usuario;
        res.locals.usuarioLogado = usuario;
        return next();
    } catch (erro) {
        return next(erro);
    }
};

/**
 * Exige sessao valida. Sem usuario autenticado:
 *  - requisicoes JSON recebem 401 (`ErroAutenticacao`);
 *  - requisicoes GET sao redirecionadas para `/login?proximo=<caminho interno>`;
 *  - demais metodos sao redirecionados para `/login` (sem `proximo`, pois nao
 *    faz sentido repetir um POST apos o login).
 * @type {import('express').RequestHandler}
 */
const exigirLogin = (req, res, next) => {
    if (req.usuario) return next();

    if (esperaJson(req)) {
        return next(new ErroAutenticacao('Sessão expirada. Faça login novamente.'));
    }

    const destino = comBase(req, res, '/login');

    if (req.method !== 'GET') {
        return res.redirect(destino);
    }

    // `req.originalUrl` ja vem sem o BASE_PATH (removido pelo proxy reverso).
    const proximo = String(req.originalUrl || '/');
    const seguro = proximo.startsWith('/') && !proximo.startsWith('//');

    return res.redirect(seguro ? `${destino}?proximo=${encodeURIComponent(proximo)}` : destino);
};

/**
 * Impede que um usuario autenticado veja a tela de login novamente.
 * @type {import('express').RequestHandler}
 */
const bloquearAutenticado = (req, res, next) => {
    const autenticado = Boolean(req.usuario) || Boolean(req.session && req.session.usuarioId);
    if (!autenticado) return next();
    return res.redirect(comBase(req, res, '/admin'));
};

module.exports = {
    exigirLogin,
    carregarUsuario,
    bloquearAutenticado,
    comBase,
};
