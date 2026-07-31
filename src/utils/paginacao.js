const TAMANHOS_PAGINA = [10, 20, 50, 100];
const TAMANHO_PADRAO = 20;

const inteiroSeguro = (valor, padrao) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : padrao;
};

/**
 * Interpreta os parametros de paginacao vindos da query string.
 */
const lerParametros = (query = {}) => {
    const pagina = Math.max(inteiroSeguro(query.pagina, 1), 1);
    const solicitado = inteiroSeguro(query.por_pagina, TAMANHO_PADRAO);
    const porPagina = TAMANHOS_PAGINA.includes(solicitado) ? solicitado : TAMANHO_PADRAO;
    return { pagina, porPagina, offset: (pagina - 1) * porPagina };
};

/**
 * Monta o objeto entregue as views a partir do total de registros.
 */
const montar = ({ pagina, porPagina }, totalRegistros) => {
    const total = Number(totalRegistros) || 0;
    const totalPaginas = Math.max(Math.ceil(total / porPagina), 1);
    const paginaAtual = Math.min(pagina, totalPaginas);
    const offset = (paginaAtual - 1) * porPagina;

    return {
        paginaAtual,
        porPagina,
        totalPaginas,
        totalRegistros: total,
        offset,
        temAnterior: paginaAtual > 1,
        temProxima: paginaAtual < totalPaginas,
        inicio: total === 0 ? 0 : offset + 1,
        fim: Math.min(offset + porPagina, total),
        tamanhos: TAMANHOS_PAGINA,
    };
};

/**
 * Reconstroi a query string preservando filtros ao trocar de pagina.
 */
const queryString = (query = {}, sobrescrever = {}) => {
    const parametros = new URLSearchParams();

    Object.entries({ ...query, ...sobrescrever }).forEach(([chave, valor]) => {
        if (valor === undefined || valor === null || valor === '') return;
        parametros.set(chave, String(valor));
    });

    const texto = parametros.toString();
    return texto ? `?${texto}` : '';
};

module.exports = { lerParametros, montar, queryString, TAMANHOS_PAGINA, TAMANHO_PADRAO };
