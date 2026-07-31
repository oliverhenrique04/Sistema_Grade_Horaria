const config = require('../config/env');
const { ErroAplicacao } = require('../utils/erros');

const TITULOS = {
    403: 'Acesso negado',
    404: 'Página não encontrada',
    422: 'Dados inválidos',
    409: 'Conflito',
    500: 'Erro interno',
};

const VIEWS = {
    403: 'erros/403',
    404: 'erros/404',
    500: 'erros/500',
};

/**
 * Rota nao encontrada: delega ao tratador global com status 404.
 */
const naoEncontrado = (req, res, next) => {
    const erro = new ErroAplicacao('Página não encontrada.', {
        status: 404,
        codigo: 'nao_encontrado',
    });
    next(erro);
};

const querJson = (req) =>
    req.xhr ||
    req.get('x-requested-with') === 'XMLHttpRequest' ||
    (req.get('accept') || '').includes('application/json');

/**
 * Tratador global. Nunca vaza detalhes internos nem dados sensiveis.
 */
// eslint-disable-next-line no-unused-vars
const tratadorGlobal = (erro, req, res, next) => {
    const status = Number.isInteger(erro.status) && erro.status >= 400 ? erro.status : 500;
    const ehErroConhecido = erro instanceof ErroAplicacao;
    const mensagem =
        ehErroConhecido && erro.publico
            ? erro.message
            : 'Ocorreu um erro inesperado. Tente novamente em instantes.';

    if (status >= 500) {
        // Log sem corpo da requisicao para nao registrar senhas ou segredos.
        console.error(
            `[erro ${status}] ${req.method} ${req.originalUrl} :: ${erro.message}`,
            config.producao ? '' : erro.stack
        );
    }

    if (res.headersSent) {
        return;
    }

    if (querJson(req)) {
        res.status(status).json({
            erro: mensagem,
            codigo: erro.codigo || null,
            detalhes: ehErroConhecido ? erro.detalhes || null : null,
        });
        return;
    }

    const view = VIEWS[status] || VIEWS[500];

    res.status(status).render(view, {
        tituloPagina: TITULOS[status] || TITULOS[500],
        status,
        mensagem,
        detalhes: ehErroConhecido ? erro.detalhes : null,
        mostrarStack: !config.producao && status >= 500 ? erro.stack : null,
    });
};

module.exports = { naoEncontrado, tratadorGlobal };
