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
/**
 * Renderiza o quadro a partir de um recorte ja resolvido.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} recorte
 */
const renderizar = async (req, res, recorte) => {
    const painel = await servico.montarPainel(recorte);
    const urlPublica = urlDaConsulta(req, recorte);

    // Cacheavel por pouco tempo, e nao `no-store`.
    //
    // Um player de sinalizacao baixa o conteudo para exibir — e o proprio nome
    // do produto diz isso. `no-store` proibe guardar a resposta, e um player
    // que grava antes de mostrar simplesmente nao mostra. Trinta segundos
    // mantem o quadro fresco (a pagina se recarrega a cada 60 s) sem proibir
    // que alguem o guarde.
    res.set('Cache-Control', 'public, max-age=30');
    res.set('X-Robots-Tag', 'noindex, nofollow');

    res.render('publico/painel', {
        ...painel,
        recorte,
        tituloPagina: painel.titulo ? `${painel.titulo} · ${TITULO_BASE}` : TITULO_BASE,
        urlPublica,
        qrSvg: qrcode.paraSvg(urlPublica, { titulo: `Grade completa: ${urlPublica}` }),
    });
};

/**
 * GET /painel/:slug — painel salvo.
 *
 * E a forma preferida: o recorte mora no banco e pode ser corrigido pelo painel
 * administrativo sem ninguem subir numa escada para mexer na TV.
 *
 * Slug desconhecido nao vira 404 seco: a TV ficaria com a pagina de erro do
 * navegador ate alguem perceber. O quadro aparece pedindo configuracao, que e
 * legivel de longe e diz o que fazer.
 */
const exibirSalvo = envolver(async (req, res) => {
    const encontrado = await servico.painelPorSlug(String(req.params.slug || ''));

    if (!encontrado) {
        res.set('Cache-Control', 'no-store');
        res.set('X-Robots-Tag', 'noindex, nofollow');
        return res.status(404).render('publico/painel', {
            ...(await servico.montarPainel({})),
            configurar: true,
            motivo: 'slug',
            recorte: {},
            tituloPagina: TITULO_BASE,
            urlPublica: '',
            qrSvg: '',
        });
    }

    return renderizar(req, res, encontrado.recorte);
});

/** GET /painel — recorte na propria URL. Mantido: ha TV em producao assim. */
const exibir = envolver(async (req, res) => {
    await renderizar(req, res, validador.validarRecorte(req.query));
});

module.exports = { exibir, exibirSalvo, urlDaConsulta };
