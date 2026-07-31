const fs = require('node:fs');
const path = require('node:path');

const config = require('../config/env');
const formatadores = require('../utils/formatadores');
const dias = require('../utils/dias');

const RAIZ_PUBLICA = path.join(__dirname, '..', '..', 'public');
const selosDeArquivo = new Map();

/**
 * Selo de versao de um arquivo de `public/`.
 *
 * Em producao os estaticos saem com `max-age` de 7 dias. Sem um selo na URL, um
 * deploy que muda o CSS deixa o navegador combinando folha antiga com HTML novo
 * — a tela chega quebrada e so se conserta com recarga forcada. O selo vem da
 * data de modificacao do arquivo: muda no deploy e so nele.
 *
 * O caminho vem sempre das views, nunca da requisicao; ainda assim a resolucao e
 * confinada a `public/`. Falha em ler o arquivo devolve string vazia e a URL sai
 * sem selo, que e o comportamento de antes.
 *
 * @param {string} destino caminho comecando por "/" (ex.: "/css/admin.css")
 * @returns {string} selo curto ou "" quando o arquivo nao pode ser lido
 */
const seloDoArquivo = (destino) => {
    if (selosDeArquivo.has(destino)) return selosDeArquivo.get(destino);

    let selo = '';
    try {
        const alvo = path.resolve(RAIZ_PUBLICA, String(destino).replace(/^\/+/, ''));
        if (alvo === RAIZ_PUBLICA || alvo.startsWith(RAIZ_PUBLICA + path.sep)) {
            selo = Math.trunc(fs.statSync(alvo).mtimeMs).toString(36);
        }
    } catch {
        selo = '';
    }

    // Em desenvolvimento o selo e recalculado a cada pedido: editar o CSS e
    // recarregar a pagina basta, sem reiniciar o servidor.
    if (config.producao) selosDeArquivo.set(destino, selo);
    return selo;
};

const normalizarBasePath = (valor = '') => {
    const bruto = String(valor || '').trim();
    if (!bruto || bruto === '/') return '';
    const comBarra = bruto.startsWith('/') ? bruto : `/${bruto}`;
    return comBarra.replace(/\/+$/, '');
};

/**
 * Resolve o prefixo de URL (BASE_PATH) e expoe helpers usados por todas as views.
 * Suporta instalacao em subcaminho (ex.: /grades) via variavel de ambiente ou
 * via cabecalho X-Forwarded-Prefix enviado pelo proxy reverso.
 */
const contextoBase = (req, res, next) => {
    const prefixoCabecalho = String(req.headers['x-forwarded-prefix'] || '')
        .split(',')[0]
        .trim();

    const basePath = config.basePath || normalizarBasePath(prefixoCabecalho);

    const withBase = (destino = '/') => {
        const alvo = String(destino || '/');
        const normalizado = alvo.startsWith('/') ? alvo : `/${alvo}`;
        return `${basePath}${normalizado}`;
    };

    /** Como `withBase`, mas com selo de versao — use para CSS, JS e imagens. */
    const asset = (destino = '/') => {
        const url = withBase(destino);
        const selo = seloDoArquivo(destino);
        return selo ? `${url}?v=${selo}` : url;
    };

    req.basePath = basePath;
    req.withBase = withBase;

    res.locals.basePath = basePath;
    res.locals.withBase = withBase;
    res.locals.asset = asset;
    res.locals.urlAtual = req.originalUrl;
    res.locals.caminhoAtual = req.path;
    res.locals.formatadores = formatadores;
    res.locals.dias = dias;
    res.locals.anoAtual = new Date().getFullYear();
    res.locals.usuarioLogado = null;
    res.locals.csrfToken = '';
    res.locals.mensagens = [];
    res.locals.tituloPagina = 'Grade Horária';
    res.locals.breadcrumbs = [];

    next();
};

/**
 * Mensagens efemeras (sucesso/erro) guardadas na sessao ate a proxima resposta.
 * Uso: req.flash('sucesso', 'Registro salvo.')
 */
const flash = (req, res, next) => {
    req.flash = (tipo, texto) => {
        if (!req.session) return;
        if (!Array.isArray(req.session.flash)) req.session.flash = [];
        req.session.flash.push({ tipo, texto });
    };

    if (req.session && Array.isArray(req.session.flash) && req.session.flash.length > 0) {
        res.locals.mensagens = req.session.flash;
        req.session.flash = [];
    }

    next();
};

/**
 * Impede redirecionamentos para fora da aplicacao (open redirect).
 * Retorna um caminho interno seguro ou o padrao informado.
 */
const destinoInternoSeguro = (destino, padrao, basePath = '') => {
    const bruto = typeof destino === 'string' ? destino.trim() : '';
    if (!bruto) return padrao;

    // Precisa ser um caminho relativo a raiz e nao pode iniciar rede (//host) nem esquema.
    if (!bruto.startsWith('/') || bruto.startsWith('//') || bruto.includes('://')) {
        return padrao;
    }

    if (bruto.includes('\\') || bruto.includes('\n') || bruto.includes('\r')) {
        return padrao;
    }

    if (basePath && !bruto.startsWith(basePath)) {
        return `${basePath}${bruto}`;
    }

    return bruto;
};

module.exports = { contextoBase, flash, destinoInternoSeguro, normalizarBasePath };
