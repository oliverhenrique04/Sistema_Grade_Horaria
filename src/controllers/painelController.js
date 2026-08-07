/**
 * Painel de corredor: a pagina que fica nas TVs dos blocos.
 *
 * Controlador fino: sanea a query string, delega ao servico e renderiza. Sem
 * SQL, sem regra de negocio e sem try/catch — o tratador global responde.
 */
const { async: envolver } = require('../utils/erros');
const validador = require('../validators/painel');
const servico = require('../services/painelService');
const qrcode = require('../utils/qrcode');
const { urlPublica } = require('../utils/urls');

const TITULO_BASE = 'Painel de aulas';

/**
 * URL absoluta da consulta publica com o mesmo recorte do painel, para o QR.
 *
 * Precisa ser absoluta: o celular que le o codigo nao tem a origem da pagina.
 * Por padrao acompanha o esquema e o host pelos quais a TV chegou — http ou
 * https, tanto faz. Quando a TV usa um endereco interno que o celular do aluno
 * nao alcanca, `URL_PUBLICA` assume (ver src/utils/urls.js).
 *
 * A consulta publica so entende campus e curso; turmas e locais nao viajam.
 * Isso e proposital: o aluno chega pelo curso, e um QR mais curto vira uma
 * matriz menos densa, mais facil de ler a um metro da TV.
 *
 * @param {import('express').Request} req
 * @param {object} recorte
 * @returns {string}
 */
const urlDaConsulta = (req, recorte = {}) => {
    const parametros = new URLSearchParams();
    if (recorte.campusId) parametros.set('campus', String(recorte.campusId));
    if (recorte.cursosIds && recorte.cursosIds.length === 1) {
        parametros.set('curso', String(recorte.cursosIds[0]));
    }

    const consulta = parametros.toString();
    return urlPublica(req, consulta ? `/?${consulta}` : '/');
};

/**
 * GET /painel — quadro de aulas do recorte, na faixa do dia corrente.
 *
 * A resposta nunca e guardada em cache: o conteudo muda com o relogio, e um
 * intermediario que a segurasse por alguns minutos deixaria a TV mostrando
 * aula encerrada. Tambem nao entra em buscador: a URL e publica e permanente e
 * traz nome de professor, turma e sala do campus inteiro.
 */
const exibir = envolver(async (req, res) => {
    const recorte = validador.validarRecorte(req.query);
    const painel = await servico.montarPainel(recorte);

    const urlPublica = urlDaConsulta(req, recorte);

    res.set('Cache-Control', 'no-store, must-revalidate');
    res.set('X-Robots-Tag', 'noindex, nofollow');

    res.render('publico/painel', {
        ...painel,
        recorte,
        tituloPagina: painel.titulo ? `${painel.titulo} · ${TITULO_BASE}` : TITULO_BASE,
        urlPublica,
        qrSvg: qrcode.paraSvg(urlPublica, { titulo: `Grade completa: ${urlPublica}` }),
    });
});

module.exports = { exibir, urlDaConsulta };
