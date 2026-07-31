/**
 * Recebimento de arquivo enviado por formulario (`multipart/form-data`).
 *
 * Existe para que a importacao de planilha funcione com um `<form>` comum, sem
 * JavaScript obrigatorio e sem acrescentar dependencia de upload ao projeto —
 * os pacotes usuais para isso trazem dezenas de modulos transitivos que nada
 * mais aqui utiliza.
 *
 * ORDEM DE USO (importa): o corpo precisa ser interpretado ANTES da verificacao
 * de CSRF, porque o token viaja como campo do proprio formulario. Por isso o
 * router de importacao aplica, nesta ordem, `receberArquivo()` e so depois
 * `verificarCsrf` — ver `routes/admin/importacao.js`.
 *
 * Limites deliberados: um unico arquivo, tamanho maximo configuravel e campos
 * de texto curtos.
 *
 * O middleware NAO interrompe a requisicao quando o arquivo e recusado: ele
 * anota o motivo em `req.arquivoRecusado` e segue. Assim o controller reexibe o
 * proprio formulario com a mensagem ao lado do campo, em vez de jogar o
 * operador numa pagina de erro generica que perde tudo o que ele preencheu.
 */
const express = require('express');
const { ErroValidacao } = require('../utils/erros');

/** Tamanho maximo de um campo de texto do formulario. */
const LIMITE_CAMPO_TEXTO = 4096;

/** Quebra de linha usada pelo protocolo multipart. */
const CRLF = Buffer.from('\r\n');

/**
 * Le o boundary declarado no cabecalho Content-Type.
 * @param {string} contentType
 * @returns {string|null}
 */
const lerBoundary = (contentType = '') => {
    const partes = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!partes) return null;
    return (partes[1] || partes[2] || '').trim() || null;
};

/**
 * Interpreta o cabecalho `Content-Disposition` de uma parte.
 * @param {string} cabecalhos
 * @returns {{nome:string, arquivo:string|null}}
 */
const lerDisposicao = (cabecalhos) => {
    const linha = cabecalhos.split('\r\n').find((item) => /^content-disposition:/i.test(item));

    if (!linha) return { nome: '', arquivo: null };

    const nome = /;\s*name="([^"]*)"/i.exec(linha);
    const arquivo = /;\s*filename="([^"]*)"/i.exec(linha);

    return {
        nome: nome ? nome[1] : '',
        // O navegador manda filename="" quando nenhum arquivo foi escolhido.
        arquivo: arquivo && arquivo[1] ? arquivo[1] : null,
    };
};

/**
 * Divide o corpo nas partes delimitadas pelo boundary.
 * @param {Buffer} corpo
 * @param {string} boundary
 * @returns {Array<{cabecalhos:string, conteudo:Buffer}>}
 */
const separarPartes = (corpo, boundary) => {
    const delimitador = Buffer.from(`--${boundary}`);
    const partes = [];

    let posicao = corpo.indexOf(delimitador);
    if (posicao === -1) return partes;

    posicao += delimitador.length;

    while (posicao < corpo.length) {
        // "--" logo apos o delimitador marca o fim do corpo.
        if (corpo[posicao] === 0x2d && corpo[posicao + 1] === 0x2d) break;

        const inicioCabecalhos = corpo.indexOf(CRLF, posicao);
        if (inicioCabecalhos === -1) break;

        const fimCabecalhos = corpo.indexOf('\r\n\r\n', inicioCabecalhos);
        if (fimCabecalhos === -1) break;

        const cabecalhos = corpo.toString('utf8', inicioCabecalhos + 2, fimCabecalhos);
        const inicioConteudo = fimCabecalhos + 4;

        const proximo = corpo.indexOf(delimitador, inicioConteudo);
        if (proximo === -1) break;

        // O CRLF que antecede o proximo delimitador nao faz parte do conteudo.
        partes.push({
            cabecalhos,
            conteudo: corpo.subarray(inicioConteudo, Math.max(inicioConteudo, proximo - 2)),
        });

        posicao = proximo + delimitador.length;
    }

    return partes;
};

/**
 * Cria o middleware que interpreta o formulario com arquivo.
 *
 * Preenche `req.body` com os campos de texto (para que o CSRF encontre `_csrf`)
 * e `req.arquivo` com `{nome, tamanho, conteudo}` do arquivo enviado.
 *
 * @param {{campo?:string, limiteBytes?:number, extensoes?:string[]}} [opcoes]
 * @returns {import('express').RequestHandler}
 */
const receberArquivo = ({
    campo = 'arquivo',
    limiteBytes = 25 * 1024 * 1024,
    extensoes = ['.xlsx'],
} = {}) => {
    const lerCorpo = express.raw({ type: 'multipart/form-data', limit: limiteBytes });

    const megabytes = Math.floor(limiteBytes / (1024 * 1024));

    return (req, res, next) => {
        if (!/^multipart\/form-data/i.test(req.headers['content-type'] || '')) return next();

        lerCorpo(req, res, (erro) => {
            if (erro) {
                // Corpo grande demais nunca chega a ser lido: sem `_csrf`, a
                // requisicao seria recusada mais adiante de qualquer forma.
                if (erro.type === 'entity.too.large' || erro.status === 413) {
                    return next(
                        new ErroValidacao('Arquivo muito grande.', {
                            arquivo: `O arquivo excede o limite de ${megabytes} MB.`,
                        })
                    );
                }
                return next(erro);
            }

            const boundary = lerBoundary(req.headers['content-type']);
            if (!boundary || !Buffer.isBuffer(req.body)) {
                req.body = {};
                req.arquivo = null;
                req.arquivoRecusado = 'Não foi possível ler o formulário. Tente enviar novamente.';
                return next();
            }

            const corpo = req.body;
            const campos = {};
            let arquivo = null;

            for (const parte of separarPartes(corpo, boundary)) {
                const { nome, arquivo: nomeArquivo } = lerDisposicao(parte.cabecalhos);
                if (!nome) continue;

                if (!nomeArquivo) {
                    if (parte.conteudo.length <= LIMITE_CAMPO_TEXTO) {
                        campos[nome] = parte.conteudo.toString('utf8');
                    }
                    continue;
                }

                if (nome !== campo || arquivo) continue;

                arquivo = {
                    nome: nomeArquivo.replace(/[\\/]/g, '_').slice(0, 255),
                    tamanho: parte.conteudo.length,
                    conteudo: parte.conteudo,
                };
            }

            req.body = campos;
            req.arquivo = arquivo;
            req.arquivoRecusado = null;

            if (arquivo && extensoes.length > 0) {
                const aceito = extensoes.some((extensao) =>
                    arquivo.nome.toLowerCase().endsWith(extensao)
                );
                if (!aceito) {
                    req.arquivo = null;
                    req.arquivoRecusado = `Envie um arquivo ${extensoes.join(' ou ')}.`;
                }
            }

            return next();
        });
    };
};

module.exports = { receberArquivo, separarPartes, lerBoundary };
