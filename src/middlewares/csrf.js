/**
 * Protecao CSRF por token sincronizado na sessao (sem dependencia externa:
 * o pacote `csurf` esta descontinuado).
 *
 * Como funciona:
 *  1. `gerarToken` cria um token aleatorio por sessao (`req.session.csrfToken`)
 *     e o expoe em `res.locals.csrfToken`;
 *  2. `verificarCsrf` compara, nos metodos que alteram estado, o token enviado
 *     (`req.body._csrf` ou cabecalho `x-csrf-token`) com o da sessao, em tempo
 *     constante.
 *
 * IMPORTANTE PARA AS VIEWS: todo formulario que faz POST/PUT/PATCH/DELETE
 * precisa incluir o campo oculto abaixo, senao a requisicao sera rejeitada:
 *
 *     <input type="hidden" name="_csrf" value="<%= csrfToken %>">
 *
 * Em chamadas fetch/XHR envie o cabecalho `x-csrf-token` com o mesmo valor.
 *
 * Ordem obrigatoria no app: sessao -> parsers de body -> gerarToken ->
 * verificarCsrf (o token so pode ser lido depois do body ter sido interpretado).
 */
const crypto = require('node:crypto');
const { ErroPermissao } = require('../utils/erros');

const METODOS_PROTEGIDOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const MENSAGEM_FALHA =
    'Sessão expirada ou requisição inválida. Recarregue a página e tente novamente.';

/**
 * Comparacao em tempo constante entre dois tokens.
 * @param {string} recebido
 * @param {string} esperado
 * @returns {boolean}
 */
const compararTokens = (recebido, esperado) => {
    if (typeof recebido !== 'string' || typeof esperado !== 'string') return false;
    if (!recebido || !esperado) return false;

    const bufferRecebido = Buffer.from(recebido, 'utf8');
    const bufferEsperado = Buffer.from(esperado, 'utf8');

    // timingSafeEqual exige buffers de mesmo tamanho.
    if (bufferRecebido.length !== bufferEsperado.length) return false;

    return crypto.timingSafeEqual(bufferRecebido, bufferEsperado);
};

/**
 * Cria (se necessario) e expoe o token CSRF da sessao.
 * @type {import('express').RequestHandler}
 */
const gerarToken = (req, res, next) => {
    if (!req.session) {
        res.locals.csrfToken = '';
        return next();
    }

    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }

    res.locals.csrfToken = req.session.csrfToken;
    return next();
};

/**
 * Renova o token da sessao. Deve ser chamado apos `req.session.regenerate()`
 * (login), pois a sessao antiga e descartada junto com o token.
 * @param {import('express').Request} req
 * @param {import('express').Response} [res]
 * @returns {string} o novo token
 */
const renovarToken = (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    if (req.session) req.session.csrfToken = token;
    if (res && res.locals) res.locals.csrfToken = token;
    return token;
};

/**
 * Valida o token CSRF nos metodos que alteram estado.
 * @type {import('express').RequestHandler}
 */
const verificarCsrf = (req, res, next) => {
    if (!METODOS_PROTEGIDOS.has(req.method)) return next();

    const enviado =
        (req.body && typeof req.body._csrf === 'string' ? req.body._csrf : '') ||
        (typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : '');

    const esperado = req.session ? req.session.csrfToken : '';

    if (!compararTokens(enviado, esperado)) {
        return next(new ErroPermissao(MENSAGEM_FALHA));
    }

    return next();
};

module.exports = { gerarToken, verificarCsrf, renovarToken, MENSAGEM_FALHA };
