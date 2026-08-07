/**
 * Montagem de URLs absolutas.
 *
 * A aplicacao atende o mesmo conteudo por http e por https — as TVs dos blocos
 * costumam chegar por um endereco interno sem TLS enquanto o publico entra pelo
 * endereco publico com TLS. Nada aqui fixa um esquema: tudo sai da requisicao,
 * ou de `URL_PUBLICA` quando a resposta precisa ser lida fora da rede que a
 * serviu.
 */
const config = require('../config/env');

/**
 * Origem (esquema + host) da requisicao corrente.
 *
 * Sai de `req.protocol` e `req.host`, e nao dos cabecalhos `x-forwarded-*`
 * crus: os dois respeitam o `trust proxy` da aplicacao, entao seguem a
 * configuracao se ela for endurecida. Ler o cabecalho na mao aceitaria o valor
 * de qualquer cliente, independentemente da configuracao.
 *
 * @param {import('express').Request} req
 * @returns {string} origem sem barra final, ou '' quando o host e desconhecido
 */
const origemDaRequisicao = (req) => {
    const host = req.host || req.headers.host || '';
    return host ? `${req.protocol}://${host}` : '';
};

/**
 * URL absoluta de um caminho interno, com o prefixo de `BASE_PATH` aplicado.
 * Sem host conhecido devolve o caminho relativo, que ainda funciona no
 * navegador que fez o pedido.
 *
 * @param {import('express').Request} req
 * @param {string} caminho caminho comecando por '/'
 * @returns {string}
 */
const urlAbsoluta = (req, caminho) => {
    const relativo = req.withBase(caminho);
    const origem = origemDaRequisicao(req);
    return origem ? `${origem}${relativo}` : relativo;
};

/**
 * URL absoluta para ser aberta FORA da rede que serviu a pagina — hoje, o
 * destino do QR do painel.
 *
 * Com `URL_PUBLICA` configurada, e ela que manda: a TV pode estar num endereco
 * interno por http e o QR ainda apontar para o endereco publico por https.
 * Sem ela, cai na origem da requisicao, que e o comportamento correto quando os
 * dois enderecos coincidem.
 *
 * @param {import('express').Request} req
 * @param {string} caminho
 * @returns {string}
 */
const urlPublica = (req, caminho) => {
    if (config.urlPublica) return `${config.urlPublica}${req.withBase(caminho)}`;
    return urlAbsoluta(req, caminho);
};

module.exports = { origemDaRequisicao, urlAbsoluta, urlPublica };
