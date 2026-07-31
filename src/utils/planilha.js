/**
 * Leitor de planilhas .xlsx (Office Open XML), sem dependencias externas.
 *
 * Um .xlsx e um arquivo ZIP com XML dentro. As bibliotecas de mercado para isso
 * arrastam dezenas de pacotes transitivos (compressao, csv, streams) que este
 * projeto nao usa para mais nada; o formato, por outro lado, e simples o
 * suficiente para ser lido com o `zlib` que ja vem no Node.
 *
 * O que este leitor suporta (o que a exportacao do cubo do TOTVS produz):
 *  - entradas ZIP armazenadas (metodo 0) ou deflacionadas (metodo 8);
 *  - `sharedStrings.xml`, incluindo texto rico (`<r><t>`);
 *  - celulas de texto (`t="s"`, `t="str"`, `t="inlineStr"`), numero e booleano;
 *  - linhas e colunas esparsas (celulas vazias sao omitidas pelo Excel).
 *
 * O que NAO suporta, de proposito: ZIP64, planilha protegida por senha e
 * formulas (le-se o valor calculado, nunca a formula). Nesses casos a leitura
 * falha com mensagem explicita em vez de devolver dado silenciosamente errado.
 */
const zlib = require('node:zlib');

/** Assinaturas do formato ZIP. */
const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_DIRETORIO = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

/** Marcador de tamanho que indica ZIP64 (nao suportado). */
const MARCADOR_ZIP64 = 0xffffffff;

/** Tamanho maximo aceito para o XML descompactado de uma unica entrada. */
const LIMITE_ENTRADA_BYTES = 256 * 1024 * 1024;

class ErroPlanilha extends Error {
    constructor(mensagem) {
        super(mensagem);
        this.name = 'ErroPlanilha';
    }
}

// ---------------------------------------------------------------------------
// Leitura do container ZIP
// ---------------------------------------------------------------------------

/**
 * Localiza o registro final do diretorio central (EOCD), que fica no fim do
 * arquivo e pode ser seguido por um comentario de ate 65535 bytes.
 * @param {Buffer} buffer
 * @returns {number} posicao do EOCD
 */
const localizarFimDoDiretorio = (buffer) => {
    const minimo = Math.max(0, buffer.length - (22 + 0xffff));

    for (let posicao = buffer.length - 22; posicao >= minimo; posicao -= 1) {
        if (buffer.readUInt32LE(posicao) === ASSINATURA_EOCD) return posicao;
    }

    throw new ErroPlanilha(
        'Arquivo não é uma planilha .xlsx válida (estrutura ZIP não encontrada).'
    );
};

/**
 * Le o diretorio central e devolve o indice das entradas do arquivo.
 * @param {Buffer} buffer
 * @returns {Map<string, {metodo:number, tamanhoComprimido:number, tamanho:number, offsetLocal:number}>}
 */
const lerDiretorio = (buffer) => {
    const fim = localizarFimDoDiretorio(buffer);
    const total = buffer.readUInt16LE(fim + 10);
    let posicao = buffer.readUInt32LE(fim + 16);

    if (posicao === MARCADOR_ZIP64) {
        throw new ErroPlanilha('Planilha em formato ZIP64 não é suportada.');
    }

    const entradas = new Map();

    for (let indice = 0; indice < total; indice += 1) {
        if (posicao + 46 > buffer.length || buffer.readUInt32LE(posicao) !== ASSINATURA_DIRETORIO) {
            throw new ErroPlanilha('Arquivo .xlsx corrompido (diretório interno inconsistente).');
        }

        const metodo = buffer.readUInt16LE(posicao + 10);
        const tamanhoComprimido = buffer.readUInt32LE(posicao + 20);
        const tamanho = buffer.readUInt32LE(posicao + 24);
        const tamanhoNome = buffer.readUInt16LE(posicao + 28);
        const tamanhoExtra = buffer.readUInt16LE(posicao + 30);
        const tamanhoComentario = buffer.readUInt16LE(posicao + 32);
        const offsetLocal = buffer.readUInt32LE(posicao + 42);

        if (tamanho === MARCADOR_ZIP64 || offsetLocal === MARCADOR_ZIP64) {
            throw new ErroPlanilha('Planilha em formato ZIP64 não é suportada.');
        }

        const nome = buffer.toString('utf8', posicao + 46, posicao + 46 + tamanhoNome);
        entradas.set(nome, { metodo, tamanhoComprimido, tamanho, offsetLocal });

        posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
    }

    return entradas;
};

/**
 * Extrai uma entrada do ZIP como texto UTF-8.
 * @param {Buffer} buffer
 * @param {Map<string, object>} entradas
 * @param {string} nome caminho interno (ex.: 'xl/sharedStrings.xml')
 * @returns {string|null} conteudo ou null quando a entrada nao existe
 */
const extrair = (buffer, entradas, nome) => {
    const entrada = entradas.get(nome);
    if (!entrada) return null;

    if (entrada.tamanho > LIMITE_ENTRADA_BYTES) {
        throw new ErroPlanilha('Planilha excede o tamanho máximo suportado.');
    }

    const cabecalho = entrada.offsetLocal;
    if (cabecalho + 30 > buffer.length || buffer.readUInt32LE(cabecalho) !== ASSINATURA_LOCAL) {
        throw new ErroPlanilha(`Arquivo .xlsx corrompido ao ler "${nome}".`);
    }

    const tamanhoNome = buffer.readUInt16LE(cabecalho + 26);
    const tamanhoExtra = buffer.readUInt16LE(cabecalho + 28);
    const inicio = cabecalho + 30 + tamanhoNome + tamanhoExtra;
    const bruto = buffer.subarray(inicio, inicio + entrada.tamanhoComprimido);

    if (entrada.metodo === 0) return bruto.toString('utf8');

    if (entrada.metodo !== 8) {
        throw new ErroPlanilha(
            `Compressão não suportada na planilha (método ${entrada.metodo}). Salve novamente como .xlsx.`
        );
    }

    try {
        return zlib
            .inflateRawSync(bruto, { maxOutputLength: LIMITE_ENTRADA_BYTES })
            .toString('utf8');
    } catch (erro) {
        throw new ErroPlanilha(
            `Não foi possível descompactar a planilha. Ela pode estar corrompida ou protegida por senha. (${erro.message})`
        );
    }
};

// ---------------------------------------------------------------------------
// Leitura do XML
// ---------------------------------------------------------------------------

const ENTIDADES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
};

/**
 * Resolve as entidades XML de um trecho de texto.
 * @param {string} texto
 * @returns {string}
 */
const decodificar = (texto) => {
    if (!texto.includes('&')) return texto;
    return texto.replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (entidade) => {
        if (ENTIDADES[entidade]) return ENTIDADES[entidade];
        const numerico = entidade.slice(2, -1);
        const codigo =
            numerico.startsWith('x') || numerico.startsWith('X')
                ? Number.parseInt(numerico.slice(1), 16)
                : Number.parseInt(numerico, 10);
        return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : entidade;
    });
};

/**
 * Concatena o conteudo de todas as tags `<t>` de um trecho (texto rico do Excel
 * quebra a mesma celula em varios `<r><t>`).
 * @param {string} trecho
 * @returns {string}
 */
const textoDasTags = (trecho) => {
    let resultado = '';
    let posicao = 0;

    for (;;) {
        const abertura = trecho.indexOf('<t', posicao);
        if (abertura === -1) break;

        const seguinte = trecho[abertura + 2];
        if (seguinte !== '>' && seguinte !== ' ' && seguinte !== '/') {
            posicao = abertura + 2;
            continue;
        }

        const fimAbertura = trecho.indexOf('>', abertura);
        if (fimAbertura === -1) break;

        // <t/> vazio.
        if (trecho[fimAbertura - 1] === '/') {
            posicao = fimAbertura + 1;
            continue;
        }

        const fechamento = trecho.indexOf('</t>', fimAbertura);
        if (fechamento === -1) break;

        resultado += decodificar(trecho.slice(fimAbertura + 1, fechamento));
        posicao = fechamento + 4;
    }

    return resultado;
};

/**
 * Le a tabela de textos compartilhados.
 * @param {string|null} xml
 * @returns {string[]}
 */
const lerTextosCompartilhados = (xml) => {
    if (!xml) return [];

    const textos = [];
    let posicao = 0;

    for (;;) {
        const abertura = xml.indexOf('<si', posicao);
        if (abertura === -1) break;

        const fimAbertura = xml.indexOf('>', abertura);
        if (fimAbertura === -1) break;

        if (xml[fimAbertura - 1] === '/') {
            textos.push('');
            posicao = fimAbertura + 1;
            continue;
        }

        const fechamento = xml.indexOf('</si>', fimAbertura);
        if (fechamento === -1) break;

        textos.push(textoDasTags(xml.slice(fimAbertura + 1, fechamento)));
        posicao = fechamento + 5;
    }

    return textos;
};

/**
 * Converte a parte alfabetica de uma referencia de celula ("BC12") no indice da
 * coluna, comecando em zero.
 * @param {string} referencia
 * @returns {number}
 */
const indiceDaColuna = (referencia) => {
    let indice = 0;

    for (let posicao = 0; posicao < referencia.length; posicao += 1) {
        const codigo = referencia.charCodeAt(posicao);
        if (codigo < 65 || codigo > 90) break;
        indice = indice * 26 + (codigo - 64);
    }

    return indice - 1;
};

/**
 * Le o valor de um atributo de uma tag ja isolada.
 * @param {string} tag
 * @param {string} nome
 * @returns {string}
 */
const atributo = (tag, nome) => {
    const marcador = ` ${nome}="`;
    const inicio = tag.indexOf(marcador);
    if (inicio === -1) return '';
    const fim = tag.indexOf('"', inicio + marcador.length);
    if (fim === -1) return '';
    return tag.slice(inicio + marcador.length, fim);
};

/**
 * Le o conteudo da primeira ocorrencia de uma tag simples dentro do trecho.
 * @param {string} trecho
 * @param {string} nome
 * @returns {string|null}
 */
const conteudoDaTag = (trecho, nome) => {
    const abertura = trecho.indexOf(`<${nome}`);
    if (abertura === -1) return null;

    const fimAbertura = trecho.indexOf('>', abertura);
    if (fimAbertura === -1) return null;
    if (trecho[fimAbertura - 1] === '/') return '';

    const fechamento = trecho.indexOf(`</${nome}>`, fimAbertura);
    if (fechamento === -1) return null;

    return trecho.slice(fimAbertura + 1, fechamento);
};

/**
 * Interpreta uma celula e devolve o valor ja tipado.
 * @param {string} tagAbertura
 * @param {string} corpo
 * @param {string[]} compartilhados
 * @returns {string|number|boolean|null}
 */
const valorDaCelula = (tagAbertura, corpo, compartilhados) => {
    const tipo = atributo(tagAbertura, 't');

    if (tipo === 'inlineStr') {
        const texto = textoDasTags(corpo);
        return texto === '' ? null : texto;
    }

    const bruto = conteudoDaTag(corpo, 'v');
    if (bruto === null || bruto === '') return null;

    if (tipo === 's') {
        const indice = Number.parseInt(bruto, 10);
        return compartilhados[indice] ?? null;
    }

    if (tipo === 'str' || tipo === 'e') return decodificar(bruto);
    if (tipo === 'b') return bruto === '1';

    const numero = Number(bruto);
    return Number.isFinite(numero) ? numero : decodificar(bruto);
};

/**
 * Le as linhas da planilha, cada uma como array posicional de valores.
 * @param {string} xml conteudo de xl/worksheets/sheetN.xml
 * @param {string[]} compartilhados
 * @param {{limiteLinhas:number}} opcoes
 * @returns {Array<Array<any>>}
 */
const lerLinhas = (xml, compartilhados, { limiteLinhas }) => {
    const linhas = [];
    let posicao = 0;

    for (;;) {
        const aberturaLinha = xml.indexOf('<row', posicao);
        if (aberturaLinha === -1) break;

        const fimAberturaLinha = xml.indexOf('>', aberturaLinha);
        if (fimAberturaLinha === -1) break;

        if (xml[fimAberturaLinha - 1] === '/') {
            linhas.push([]);
            posicao = fimAberturaLinha + 1;
            continue;
        }

        const fechamentoLinha = xml.indexOf('</row>', fimAberturaLinha);
        if (fechamentoLinha === -1) break;

        const corpoLinha = xml.slice(fimAberturaLinha + 1, fechamentoLinha);
        const linha = [];
        let cursor = 0;
        let proximaColuna = 0;

        for (;;) {
            const aberturaCelula = corpoLinha.indexOf('<c', cursor);
            if (aberturaCelula === -1) break;

            const seguinte = corpoLinha[aberturaCelula + 2];
            if (seguinte !== '>' && seguinte !== ' ' && seguinte !== '/') {
                cursor = aberturaCelula + 2;
                continue;
            }

            const fimAberturaCelula = corpoLinha.indexOf('>', aberturaCelula);
            if (fimAberturaCelula === -1) break;

            const tagAbertura = corpoLinha.slice(aberturaCelula, fimAberturaCelula + 1);
            const referencia = atributo(tagAbertura, 'r');
            const coluna = referencia ? indiceDaColuna(referencia) : proximaColuna;

            let corpoCelula = '';
            if (corpoLinha[fimAberturaCelula - 1] === '/') {
                cursor = fimAberturaCelula + 1;
            } else {
                const fechamentoCelula = corpoLinha.indexOf('</c>', fimAberturaCelula);
                if (fechamentoCelula === -1) break;
                corpoCelula = corpoLinha.slice(fimAberturaCelula + 1, fechamentoCelula);
                cursor = fechamentoCelula + 4;
            }

            if (coluna >= 0) {
                while (linha.length < coluna) linha.push(null);
                linha[coluna] = valorDaCelula(tagAbertura, corpoCelula, compartilhados);
                proximaColuna = coluna + 1;
            }
        }

        linhas.push(linha);
        posicao = fechamentoLinha + 6;

        if (linhas.length > limiteLinhas) {
            throw new ErroPlanilha(
                `A planilha tem mais de ${limiteLinhas.toLocaleString('pt-BR')} linhas. Divida o arquivo antes de importar.`
            );
        }
    }

    return linhas;
};

/**
 * Descobre o caminho interno da primeira planilha do arquivo.
 * @param {Map<string, object>} entradas
 * @returns {string}
 */
const caminhoDaPrimeiraAba = (entradas) => {
    const candidatos = [...entradas.keys()]
        .filter((nome) => /^xl\/worksheets\/sheet\d+\.xml$/.test(nome))
        .sort((a, b) => {
            const numero = (nome) => Number.parseInt(nome.replace(/\D+/g, ''), 10) || 0;
            return numero(a) - numero(b);
        });

    if (candidatos.length === 0) {
        throw new ErroPlanilha('A planilha não contém nenhuma aba de dados.');
    }

    return candidatos[0];
};

/**
 * Le a primeira aba de uma planilha .xlsx.
 *
 * @param {Buffer} buffer conteudo bruto do arquivo
 * @param {{limiteLinhas?:number}} [opcoes]
 * @returns {{cabecalho:string[], linhas:Array<Record<string, any>>, totalLinhas:number}}
 *   `linhas` traz um objeto por linha, com as chaves do cabecalho ja normalizadas
 *   (sem espacos nas pontas). Linhas totalmente vazias sao descartadas.
 * @throws {ErroPlanilha}
 */
const lerPrimeiraAba = (buffer, { limiteLinhas = 200000 } = {}) => {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new ErroPlanilha('Nenhum arquivo foi recebido.');
    }

    // "PK": todo .xlsx comeca com a assinatura de arquivo ZIP.
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== ASSINATURA_LOCAL) {
        throw new ErroPlanilha(
            'O arquivo enviado não é uma planilha .xlsx. Exporte novamente pelo Excel (formato .xlsx).'
        );
    }

    const entradas = lerDiretorio(buffer);
    const compartilhados = lerTextosCompartilhados(
        extrair(buffer, entradas, 'xl/sharedStrings.xml')
    );
    const aba = extrair(buffer, entradas, caminhoDaPrimeiraAba(entradas));

    if (aba === null) throw new ErroPlanilha('A planilha não contém nenhuma aba de dados.');

    const linhasBrutas = lerLinhas(aba, compartilhados, { limiteLinhas });
    if (linhasBrutas.length === 0) throw new ErroPlanilha('A planilha está vazia.');

    const cabecalho = linhasBrutas[0].map((valor) =>
        valor === null || valor === undefined ? '' : String(valor).trim()
    );

    if (cabecalho.every((titulo) => titulo === '')) {
        throw new ErroPlanilha(
            'A primeira linha da planilha precisa conter os títulos das colunas.'
        );
    }

    const linhas = [];

    for (let indice = 1; indice < linhasBrutas.length; indice += 1) {
        const bruta = linhasBrutas[indice];
        if (!bruta.some((valor) => valor !== null && valor !== undefined && valor !== '')) continue;

        const registro = { __linha: indice + 1 };
        cabecalho.forEach((titulo, coluna) => {
            if (!titulo) return;
            const valor = bruta[coluna];
            registro[titulo] = valor === undefined ? null : valor;
        });

        linhas.push(registro);
    }

    return { cabecalho, linhas, totalLinhas: linhasBrutas.length - 1 };
};

module.exports = { lerPrimeiraAba, ErroPlanilha };
