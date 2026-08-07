/**
 * Gerador de QR Code (modo byte, correcao de erro M) com saida em SVG.
 *
 * Por que codigo proprio, e nao uma dependencia: o painel de TV precisa do QR
 * renderizado no servidor, sem rede e sem canvas. As bibliotecas usuais trazem
 * dezenas de pacotes transitivos que nada mais no projeto usa — a mesma razao
 * que levou o leitor de `.xlsx` e o upload a serem escritos a mao (ver
 * CLAUDE.md). O algoritmo e fechado e a saida e verificavel: `tests/qrcode.test.js`
 * compara a matriz inteira contra vetores gerados por um codificador de
 * referencia.
 *
 * Escopo deliberado: versoes 1 a 10, nivel M, apenas modo byte (UTF-8). Isso
 * cobre ate 213 bytes — muito acima da URL mais longa que o gerador de links
 * produz. Texto maior devolve erro em vez de degradar em silencio.
 */

/** Nivel de correcao usado em todo o projeto (recupera ~15% dos modulos). */
const NIVEL_M = 0b00;

/** Maior versao suportada. Acima disso a matriz fica densa demais para a TV. */
const VERSAO_MAXIMA = 10;

/**
 * Estrutura de blocos por versao no nivel M: quantos codewords de correcao por
 * bloco e como os codewords de dados se repartem entre os blocos.
 * Fonte: ISO/IEC 18004, tabela 9.
 */
const BLOCOS_M = [
    null, // indice 0 nao existe (versoes comecam em 1)
    { correcao: 10, grupos: [[1, 16]] },
    { correcao: 16, grupos: [[1, 28]] },
    { correcao: 26, grupos: [[1, 44]] },
    { correcao: 18, grupos: [[2, 32]] },
    { correcao: 24, grupos: [[2, 43]] },
    { correcao: 16, grupos: [[4, 27]] },
    { correcao: 18, grupos: [[4, 31]] },
    {
        correcao: 22,
        grupos: [
            [2, 38],
            [2, 39],
        ],
    },
    {
        correcao: 22,
        grupos: [
            [3, 36],
            [2, 37],
        ],
    },
    {
        correcao: 26,
        grupos: [
            [4, 43],
            [1, 44],
        ],
    },
];

/** Centros dos padroes de alinhamento por versao. */
const ALINHAMENTO = [
    null,
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
];

/**
 * Bits sobrando depois dos codewords, preenchidos com zero.
 * Versoes 2 a 6 tem 7; as demais faixas suportadas, nenhum.
 */
const bitsRestantes = (versao) => (versao >= 2 && versao <= 6 ? 7 : 0);

const tamanhoDaMatriz = (versao) => versao * 4 + 17;

/** Total de codewords de dados da versao (soma dos grupos). */
const codewordsDeDados = (versao) =>
    BLOCOS_M[versao].grupos.reduce((total, [blocos, porBloco]) => total + blocos * porBloco, 0);

// ---------------------------------------------------------------------------
// Campo de Galois GF(256), polinomio primitivo 0x11D
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
    let valor = 1;
    for (let i = 0; i < 255; i += 1) {
        EXP[i] = valor;
        LOG[valor] = i;
        valor <<= 1;
        if (valor & 0x100) valor ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const multiplicar = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * Polinomio gerador de Reed-Solomon para `grau` codewords de correcao.
 * @param {number} grau
 * @returns {number[]}
 */
const polinomioGerador = (grau) => {
    let gerador = [1];
    for (let i = 0; i < grau; i += 1) {
        const proximo = new Array(gerador.length + 1).fill(0);
        for (let j = 0; j < gerador.length; j += 1) {
            proximo[j] ^= gerador[j];
            proximo[j + 1] ^= multiplicar(gerador[j], EXP[i]);
        }
        gerador = proximo;
    }
    return gerador;
};

/**
 * Codewords de correcao de um bloco de dados.
 * @param {number[]} dados
 * @param {number} quantidade
 * @returns {number[]}
 */
const correcaoDoBloco = (dados, quantidade) => {
    const gerador = polinomioGerador(quantidade);
    const resto = dados.concat(new Array(quantidade).fill(0));

    for (let i = 0; i < dados.length; i += 1) {
        const fator = resto[i];
        if (fator === 0) continue;
        for (let j = 0; j < gerador.length; j += 1) {
            resto[i + j] ^= multiplicar(gerador[j], fator);
        }
    }

    return resto.slice(dados.length);
};

// ---------------------------------------------------------------------------
// BCH: informacao de formato (15 bits) e de versao (18 bits)
// ---------------------------------------------------------------------------

/** Posicao do bit mais significativo (-1 quando o valor e zero). */
const bitMaisAlto = (valor) => {
    let posicao = -1;
    let restante = valor;
    while (restante > 0) {
        restante >>>= 1;
        posicao += 1;
    }
    return posicao;
};

/**
 * Resto da divisao BCH de `valor` pelo polinomio `gerador`, cujo grau e
 * `grauGerador`. A cada passo o gerador e alinhado ao bit mais alto do resto —
 * alinhar pelo numero de deslocamentos ate o valor "caber" erra por um bit e
 * produz um codigo que renderiza bem e nao le.
 */
const restoBch = (valor, gerador, grauGerador) => {
    let resto = valor;
    let alto = bitMaisAlto(resto);
    while (alto >= grauGerador) {
        resto ^= gerador << (alto - grauGerador);
        alto = bitMaisAlto(resto);
    }
    return resto;
};

/**
 * 15 bits de informacao de formato: nivel de correcao + mascara, com BCH(15,5)
 * e mascara fixa 0x5412 (a norma exige que o resultado nunca seja todo zero).
 */
const informacaoDeFormato = (mascara) => {
    const dados = (NIVEL_M << 3) | mascara;
    const bch = restoBch(dados << 10, 0b10100110111, 10);
    return ((dados << 10) | bch) ^ 0b101010000010010;
};

/** 18 bits de informacao de versao (obrigatoria a partir da versao 7). */
const informacaoDeVersao = (versao) => {
    const bch = restoBch(versao << 12, 0b1111100100101, 12);
    return (versao << 12) | bch;
};

// ---------------------------------------------------------------------------
// Codificacao dos dados
// ---------------------------------------------------------------------------

/**
 * Menor versao que comporta `bytes` no nivel M.
 * @param {number} tamanho
 * @returns {number}
 * @throws {Error} quando o texto nao cabe na versao maxima suportada
 */
const escolherVersao = (tamanho) => {
    for (let versao = 1; versao <= VERSAO_MAXIMA; versao += 1) {
        // 4 bits de modo + indicador de tamanho (8 bits ate a versao 9, 16 depois).
        const cabecalho = 4 + (versao <= 9 ? 8 : 16);
        if (codewordsDeDados(versao) * 8 >= cabecalho + tamanho * 8) return versao;
    }
    throw new Error(`Texto longo demais para um QR versao ${VERSAO_MAXIMA} nivel M.`);
};

/**
 * Monta os codewords de dados (modo byte) ja com terminador e preenchimento.
 * @param {Buffer} bytes
 * @param {number} versao
 * @returns {number[]}
 */
const montarCodewords = (bytes, versao) => {
    const bits = [];
    const empurrar = (valor, quantidade) => {
        for (let i = quantidade - 1; i >= 0; i -= 1) bits.push((valor >> i) & 1);
    };

    empurrar(0b0100, 4);
    empurrar(bytes.length, versao <= 9 ? 8 : 16);
    bytes.forEach((byte) => empurrar(byte, 8));

    const capacidade = codewordsDeDados(versao) * 8;

    // Terminador de ate 4 zeros, depois completa o byte corrente.
    for (let i = 0; i < 4 && bits.length < capacidade; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        codewords.push(bits.slice(i, i + 8).reduce((valor, bit) => (valor << 1) | bit, 0));
    }

    // Preenchimento alternado exigido pela norma.
    const PREENCHIMENTO = [0xec, 0x11];
    let indice = 0;
    while (codewords.length < codewordsDeDados(versao)) {
        codewords.push(PREENCHIMENTO[indice % 2]);
        indice += 1;
    }

    return codewords;
};

/**
 * Reparte os codewords em blocos, calcula a correcao e intercala na ordem
 * final exigida pela norma (dados de todos os blocos, depois a correcao).
 * @param {number[]} codewords
 * @param {number} versao
 * @returns {number[]}
 */
const intercalar = (codewords, versao) => {
    const { correcao, grupos } = BLOCOS_M[versao];
    const blocosDados = [];
    let posicao = 0;

    grupos.forEach(([quantidade, porBloco]) => {
        for (let i = 0; i < quantidade; i += 1) {
            blocosDados.push(codewords.slice(posicao, posicao + porBloco));
            posicao += porBloco;
        }
    });

    const blocosCorrecao = blocosDados.map((bloco) => correcaoDoBloco(bloco, correcao));
    const saida = [];

    const maiorBloco = Math.max(...blocosDados.map((bloco) => bloco.length));
    for (let i = 0; i < maiorBloco; i += 1) {
        blocosDados.forEach((bloco) => {
            if (i < bloco.length) saida.push(bloco[i]);
        });
    }
    for (let i = 0; i < correcao; i += 1) {
        blocosCorrecao.forEach((bloco) => saida.push(bloco[i]));
    }

    return saida;
};

// ---------------------------------------------------------------------------
// Montagem da matriz
// ---------------------------------------------------------------------------

/** Matriz de modulos: 0 claro, 1 escuro, null ainda nao definido. */
const criarMatriz = (tamanho) =>
    Array.from({ length: tamanho }, () => new Array(tamanho).fill(null));

const desenharQuadrado = (matriz, linha, coluna, tamanho, valor) => {
    for (let i = 0; i < tamanho; i += 1) {
        for (let j = 0; j < tamanho; j += 1) {
            const l = linha + i;
            const c = coluna + j;
            if (l >= 0 && l < matriz.length && c >= 0 && c < matriz.length) matriz[l][c] = valor;
        }
    }
};

/** Localizador 7x7 com o separador claro em volta. */
const desenharLocalizador = (matriz, linha, coluna) => {
    desenharQuadrado(matriz, linha - 1, coluna - 1, 9, 0);
    desenharQuadrado(matriz, linha, coluna, 7, 1);
    desenharQuadrado(matriz, linha + 1, coluna + 1, 5, 0);
    desenharQuadrado(matriz, linha + 2, coluna + 2, 3, 1);
};

const desenharAlinhamento = (matriz, versao) => {
    const centros = ALINHAMENTO[versao];
    const tamanho = matriz.length;

    centros.forEach((linha) => {
        centros.forEach((coluna) => {
            // Os cantos ocupados pelos localizadores nao recebem alinhamento.
            const noLocalizador =
                (linha <= 8 && coluna <= 8) ||
                (linha <= 8 && coluna >= tamanho - 9) ||
                (linha >= tamanho - 9 && coluna <= 8);
            if (noLocalizador) return;

            desenharQuadrado(matriz, linha - 2, coluna - 2, 5, 1);
            desenharQuadrado(matriz, linha - 1, coluna - 1, 3, 0);
            matriz[linha][coluna] = 1;
        });
    });
};

const desenharTemporizacao = (matriz) => {
    for (let i = 8; i < matriz.length - 8; i += 1) {
        const valor = i % 2 === 0 ? 1 : 0;
        if (matriz[6][i] === null) matriz[6][i] = valor;
        if (matriz[i][6] === null) matriz[i][6] = valor;
    }
};

/** Reserva as areas de formato e versao para que os dados nao as ocupem. */
const reservarAreas = (matriz, versao) => {
    const tamanho = matriz.length;

    for (let i = 0; i < 9; i += 1) {
        if (matriz[8][i] === null) matriz[8][i] = 0;
        if (matriz[i][8] === null) matriz[i][8] = 0;
    }
    for (let i = 0; i < 8; i += 1) {
        matriz[8][tamanho - 1 - i] = 0;
        matriz[tamanho - 1 - i][8] = 0;
    }

    // Modulo sempre escuro.
    matriz[tamanho - 8][8] = 1;

    if (versao >= 7) {
        for (let i = 0; i < 6; i += 1) {
            for (let j = 0; j < 3; j += 1) {
                matriz[i][tamanho - 11 + j] = 0;
                matriz[tamanho - 11 + j][i] = 0;
            }
        }
    }
};

/**
 * Percorre a matriz em zigue-zague (de baixo para cima, duas colunas por vez,
 * pulando a coluna 6 de temporizacao) gravando os bits de dados.
 */
const gravarDados = (matriz, bytes) => {
    const tamanho = matriz.length;
    const bits = [];
    bytes.forEach((byte) => {
        for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
    });

    let indice = 0;
    let subindo = true;

    for (let coluna = tamanho - 1; coluna > 0; coluna -= 2) {
        if (coluna === 6) coluna -= 1;

        for (let passo = 0; passo < tamanho; passo += 1) {
            const linha = subindo ? tamanho - 1 - passo : passo;

            for (let deslocamento = 0; deslocamento < 2; deslocamento += 1) {
                const c = coluna - deslocamento;
                if (matriz[linha][c] !== null) continue;
                matriz[linha][c] = indice < bits.length ? bits[indice] : 0;
                indice += 1;
            }
        }

        subindo = !subindo;
    }
};

const CONDICOES_MASCARA = [
    (i, j) => (i + j) % 2 === 0,
    (i) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** Quais posicoes sao funcionais (nao recebem mascara). */
const mapaFuncional = (versao) => {
    const matriz = criarMatriz(tamanhoDaMatriz(versao));
    const tamanho = matriz.length;

    desenharLocalizador(matriz, 0, 0);
    desenharLocalizador(matriz, 0, tamanho - 7);
    desenharLocalizador(matriz, tamanho - 7, 0);
    desenharAlinhamento(matriz, versao);
    desenharTemporizacao(matriz);
    reservarAreas(matriz, versao);

    return matriz.map((linha) => linha.map((valor) => valor !== null));
};

const aplicarMascara = (matriz, funcional, mascara) => {
    const condicao = CONDICOES_MASCARA[mascara];
    const saida = matriz.map((linha) => linha.slice());

    for (let i = 0; i < matriz.length; i += 1) {
        for (let j = 0; j < matriz.length; j += 1) {
            if (funcional[i][j]) continue;
            if (condicao(i, j)) saida[i][j] ^= 1;
        }
    }

    return saida;
};

const gravarFormato = (matriz, mascara) => {
    const tamanho = matriz.length;
    const bits = informacaoDeFormato(mascara);
    const bit = (posicao) => (bits >> posicao) & 1;

    for (let i = 0; i <= 5; i += 1) matriz[8][i] = bit(14 - i);
    matriz[8][7] = bit(8);
    matriz[8][8] = bit(7);
    matriz[7][8] = bit(6);
    for (let i = 9; i <= 14; i += 1) matriz[14 - i][8] = bit(14 - i);

    // Segunda copia: 7 modulos subindo pela coluna 8 e 8 modulos indo pela
    // linha 8 ate a borda direita, sempre do bit mais significativo para o
    // menos. Duas armadilhas moram aqui: a copia le os bits em ordem inversa a
    // do indice numerico (`bit(14 - i)`, nao `bit(i)`), e o modulo sempre
    // escuro em [tamanho-8][8] nao pertence ao formato — inclui-lo na copia
    // vertical rouba um bit. Errar qualquer um dos dois gera um codigo que
    // renderiza bem e nao le.
    for (let i = 0; i <= 6; i += 1) matriz[tamanho - 1 - i][8] = bit(14 - i);
    for (let i = 7; i <= 14; i += 1) matriz[8][tamanho - 15 + i] = bit(14 - i);

    matriz[tamanho - 8][8] = 1;
};

const gravarVersao = (matriz, versao) => {
    if (versao < 7) return;
    const tamanho = matriz.length;
    const bits = informacaoDeVersao(versao);

    for (let i = 0; i < 18; i += 1) {
        const valor = (bits >> i) & 1;
        const linha = Math.floor(i / 3);
        const coluna = (i % 3) + tamanho - 11;
        matriz[linha][coluna] = valor;
        matriz[coluna][linha] = valor;
    }
};

/** Soma das quatro regras de penalidade da norma. */
const penalidade = (matriz) => {
    const tamanho = matriz.length;
    let total = 0;

    // Regra 1: sequencias de 5 ou mais modulos iguais.
    const contarLinha = (obter) => {
        for (let i = 0; i < tamanho; i += 1) {
            let anterior = -1;
            let repeticoes = 0;
            for (let j = 0; j < tamanho; j += 1) {
                const valor = obter(i, j);
                if (valor === anterior) {
                    repeticoes += 1;
                    if (repeticoes === 5) total += 3;
                    else if (repeticoes > 5) total += 1;
                } else {
                    anterior = valor;
                    repeticoes = 1;
                }
            }
        }
    };
    contarLinha((i, j) => matriz[i][j]);
    contarLinha((i, j) => matriz[j][i]);

    // Regra 2: blocos 2x2 de mesma cor.
    for (let i = 0; i < tamanho - 1; i += 1) {
        for (let j = 0; j < tamanho - 1; j += 1) {
            const valor = matriz[i][j];
            if (
                valor === matriz[i][j + 1] &&
                valor === matriz[i + 1][j] &&
                valor === matriz[i + 1][j + 1]
            ) {
                total += 3;
            }
        }
    }

    // Regra 3: padroes que imitam o localizador.
    const ALVOS = [
        [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
        [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
    ];
    const procurar = (obter) => {
        for (let i = 0; i < tamanho; i += 1) {
            for (let j = 0; j <= tamanho - 11; j += 1) {
                ALVOS.forEach((alvo) => {
                    let igual = true;
                    for (let k = 0; k < 11 && igual; k += 1) {
                        if (obter(i, j + k) !== alvo[k]) igual = false;
                    }
                    if (igual) total += 40;
                });
            }
        }
    };
    procurar((i, j) => matriz[i][j]);
    procurar((i, j) => matriz[j][i]);

    // Regra 4: desequilibrio entre modulos claros e escuros.
    let escuros = 0;
    matriz.forEach((linha) => linha.forEach((valor) => (escuros += valor)));
    const proporcao = (escuros * 100) / (tamanho * tamanho);
    total += Math.floor(Math.abs(proporcao - 50) / 5) * 10;

    return total;
};

/**
 * Gera a matriz de modulos do QR.
 *
 * `opcoes.mascara` forca uma das oito mascaras em vez de escolher pela menor
 * penalidade. Serve aos testes, que comparam as oito contra vetores de
 * referencia — comparar so a escolhida deixaria sete caminhos sem cobertura.
 *
 * @param {string} texto
 * @param {{mascara?:number}} [opcoes]
 * @returns {{versao:number, mascara:number, tamanho:number, modulos:number[][]}}
 */
const gerarMatriz = (texto, opcoes = {}) => {
    const bytes = Buffer.from(String(texto), 'utf8');
    const versao = escolherVersao(bytes.length);

    const codewords = intercalar(montarCodewords(bytes, versao), versao);
    const sobra = bitsRestantes(versao);

    const base = criarMatriz(tamanhoDaMatriz(versao));
    const tamanho = base.length;
    desenharLocalizador(base, 0, 0);
    desenharLocalizador(base, 0, tamanho - 7);
    desenharLocalizador(base, tamanho - 7, 0);
    desenharAlinhamento(base, versao);
    desenharTemporizacao(base);
    reservarAreas(base, versao);

    const funcional = mapaFuncional(versao);
    const comDados = base.map((linha) => linha.slice());
    // Os bits restantes entram como zeros: a gravacao ja preenche com zero o
    // que sobra depois dos codewords.
    void sobra;
    gravarDados(comDados, codewords);

    const montarCandidata = (mascara) => {
        const candidata = aplicarMascara(comDados, funcional, mascara);
        gravarFormato(candidata, mascara);
        gravarVersao(candidata, versao);
        return candidata;
    };

    if (Number.isInteger(opcoes.mascara)) {
        const mascara = opcoes.mascara;
        return { versao, mascara, tamanho, modulos: montarCandidata(mascara) };
    }

    let melhor = null;
    for (let mascara = 0; mascara < 8; mascara += 1) {
        const candidata = montarCandidata(mascara);
        const nota = penalidade(candidata);
        if (!melhor || nota < melhor.nota) melhor = { nota, mascara, modulos: candidata };
    }

    return { versao, mascara: melhor.mascara, tamanho, modulos: melhor.modulos };
};

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

/** Escapa o que entra em atributo XML. Só o titulo aceita texto externo. */
const escapar = (valor) =>
    String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/**
 * QR em SVG, pronto para embutir na pagina.
 *
 * O `viewBox` usa uma unidade por modulo: o tamanho final e definido por CSS,
 * o que mantem o SVG independente da resolucao da TV. A margem clara (quiet
 * zone) de 4 modulos e exigida pela norma — sem ela a camera do celular erra.
 *
 * @param {string} texto conteudo codificado (normalmente uma URL)
 * @param {{margem?:number, titulo?:string, corEscura?:string, corClara?:string}} [opcoes]
 * @returns {string} markup SVG
 */
const paraSvg = (texto, opcoes = {}) => {
    const { margem = 4, titulo = '', corEscura = '#0b0f14', corClara = '#ffffff' } = opcoes;
    const { modulos, tamanho } = gerarMatriz(texto);
    const total = tamanho + margem * 2;

    // Cada sequencia horizontal de modulos escuros vira um retangulo do path:
    // menos nos para o navegador do que um <rect> por modulo.
    const partes = [];
    for (let linha = 0; linha < tamanho; linha += 1) {
        let coluna = 0;
        while (coluna < tamanho) {
            if (!modulos[linha][coluna]) {
                coluna += 1;
                continue;
            }
            const inicio = coluna;
            while (coluna < tamanho && modulos[linha][coluna]) coluna += 1;
            const largura = coluna - inicio;
            partes.push(`M${inicio + margem} ${linha + margem}h${largura}v1h-${largura}z`);
        }
    }

    const rotulo = titulo ? `<title>${escapar(titulo)}</title>` : '';

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
        `shape-rendering="crispEdges" role="img"${titulo ? '' : ' aria-hidden="true"'}>` +
        rotulo +
        `<rect width="${total}" height="${total}" fill="${corClara}"/>` +
        `<path d="${partes.join('')}" fill="${corEscura}"/>` +
        `</svg>`
    );
};

module.exports = { paraSvg, gerarMatriz, escolherVersao, VERSAO_MAXIMA };
