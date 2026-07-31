/**
 * Controller do painel administrativo (dashboard).
 *
 * Fino por definicao: le a requisicao, chama o service e renderiza. Nenhuma
 * consulta, nenhuma regra de escopo e nenhum try/catch (o tratador global
 * responde pelos erros, gracas ao `async` de utils/erros).
 */
const dashboardService = require('../../services/dashboardService');
const { async: assincrono } = require('../../utils/erros');

/**
 * GET /admin - visao geral com indicadores, distribuicao por turno e pendencias.
 * @type {import('express').RequestHandler}
 */
const exibir = assincrono(async (req, res) => {
    // O periodo letivo vem do banco (middlewares/periodoLetivo), nunca do HTML.
    const periodoAtual = res.locals.periodoAtual || null;

    const painel = await dashboardService.montarPainel(req.usuario, { periodoAtual });

    res.render('admin/dashboard', {
        tituloPagina: 'Painel',
        subtitulo: painel.escopoDescricao,
        menuAtivo: 'dashboard',
        breadcrumbs: [{ texto: 'Painel' }],
        painel,
    });
});

module.exports = { exibir };
