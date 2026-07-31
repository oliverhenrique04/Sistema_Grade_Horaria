const { GRUPOS } = require('../config/menu');
const { temPermissao } = require('./autorizacao');

/**
 * Monta o menu lateral conforme as permissoes do usuario autenticado e expoe
 * o helper `podeVer(recurso, acao)` para as views.
 *
 * Esconder itens e apenas conveniencia: cada rota valida permissao no backend.
 */
const montarMenu = (req, res, next) => {
    const usuario = req.usuario || null;

    res.locals.podeVer = (recurso, acao = 'ler') =>
        Boolean(usuario) && temPermissao(usuario, recurso, acao);

    if (!usuario) {
        res.locals.menu = [];
        return next();
    }

    res.locals.menu = GRUPOS.map((grupo) => ({
        titulo: grupo.titulo,
        itens: grupo.itens.filter((item) => temPermissao(usuario, item.recurso, 'ler')),
    })).filter((grupo) => grupo.itens.length > 0);

    next();
};

module.exports = { montarMenu };
