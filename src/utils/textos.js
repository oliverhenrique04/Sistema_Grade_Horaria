/**
 * Normalizacao de texto usada na integracao com sistemas externos.
 *
 * O cubo do TOTVS exporta tudo em caixa alta e com acentuacao irregular
 * ("FILOSOFIA JURÍDICA" ao lado de "DIREITO PUBLICO"), entao a comparacao entre
 * o que vem da planilha e o que ja existe no banco precisa ser tolerante a
 * acento, caixa e espaco duplicado — sem que isso vaze para o que o usuario ve.
 */

/** Palavras que ficam em minusculo no meio de um titulo. */
const PALAVRAS_MINUSCULAS = new Set([
    'a',
    'as',
    'ao',
    'aos',
    'da',
    'das',
    'de',
    'do',
    'dos',
    'e',
    'em',
    'na',
    'nas',
    'no',
    'nos',
    'o',
    'os',
    'ou',
    'para',
    'por',
    'com',
    'sem',
    'sob',
    'sobre',
]);

/** Termos que permanecem em caixa alta (numerais romanos e siglas do dominio). */
const SEMPRE_MAIUSCULO = new Set([
    'I',
    'II',
    'III',
    'IV',
    'V',
    'VI',
    'VII',
    'VIII',
    'IX',
    'X',
    'XI',
    'XII',
    'TCC',
    'EAD',
    'LIBRAS',
    'NAP',
    'SUS',
    'TI',
    'UTI',
]);

/**
 * Texto sem espacos nas pontas; qualquer valor nao textual vira string vazia.
 * @param {any} valor
 * @returns {string}
 */
const texto = (valor) => {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/\s+/g, ' ').trim();
};

/**
 * Chave de comparacao: sem acento, sem caixa e sem espaco duplicado.
 * @param {any} valor
 * @returns {string}
 */
const chave = (valor) =>
    texto(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

/**
 * Titulo legivel a partir de um texto em caixa alta.
 * Preserva numerais romanos e siglas conhecidas e mantem preposicoes minusculas.
 * @param {any} valor
 * @returns {string}
 */
const titulo = (valor) => {
    const bruto = texto(valor);
    if (!bruto) return '';

    // Texto que ja vem com minusculas foi digitado por alguem: nao mexer.
    if (bruto !== bruto.toUpperCase()) return bruto;

    return bruto
        .toLowerCase()
        .split(' ')
        .map((palavra, indice) => {
            const nu = palavra.toUpperCase();
            if (SEMPRE_MAIUSCULO.has(nu)) return nu;
            if (indice > 0 && PALAVRAS_MINUSCULAS.has(palavra)) return palavra;
            return palavra.replace(/^([\p{L}])/u, (letra) => letra.toUpperCase());
        })
        .join(' ');
};

/**
 * Corta o texto no limite de caracteres da coluna, sem quebrar no meio de uma
 * palavra quando da para evitar.
 * @param {string} valor
 * @param {number} limite
 * @returns {string}
 */
const limitar = (valor, limite) => {
    const bruto = texto(valor);
    if (bruto.length <= limite) return bruto;

    const cortado = bruto.slice(0, limite);
    const espaco = cortado.lastIndexOf(' ');
    return espaco > limite * 0.6 ? cortado.slice(0, espaco) : cortado;
};

module.exports = { texto, chave, titulo, limitar };
