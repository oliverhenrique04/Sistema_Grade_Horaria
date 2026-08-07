/**
 * Gerador de QR Code (src/utils/qrcode.js).
 *
 * Um QR errado renderiza lindamente e nao le: inspecao visual nao serve de
 * verificacao. Estes testes comparam a matriz INTEIRA, modulo a modulo, contra
 * vetores gerados por um codificador de referencia independente
 * (`qrcode` do Python, ISO/IEC 18004) e congelados em
 * `tests/fixtures/qrcode-vetores.json`.
 *
 * As oito mascaras de cada texto sao comparadas, e nao apenas a escolhida:
 * comparar so a escolhida deixaria sete caminhos de codigo sem cobertura.
 *
 * Os vetores usam apenas o modo byte, que e o unico implementado (ver o
 * cabecalho do modulo). Uma string toda em maiusculas levaria o codificador de
 * referencia ao modo alfanumerico, mais compacto — irrelevante aqui, porque as
 * URLs do painel sempre contem minusculas e pontuacao.
 */
const vetores = require('./fixtures/qrcode-vetores.json');
const qrcode = require('../src/utils/qrcode');

/** Converte a matriz em uma linha de texto por fileira, como no vetor. */
const comoLinhas = (modulos) => modulos.map((linha) => linha.join(''));

describe('gerador de QR Code', () => {
    describe('matriz identica ao codificador de referencia', () => {
        vetores.forEach((vetor) => {
            const rotulo = `${vetor.texto.slice(0, 42)}${vetor.texto.length > 42 ? '...' : ''}`;

            test(`versao ${vetor.versao} — ${rotulo}`, () => {
                const gerado = qrcode.gerarMatriz(vetor.texto);
                expect(gerado.versao).toBe(vetor.versao);
                expect(gerado.tamanho).toBe(vetor.versao * 4 + 17);
            });

            Object.entries(vetor.mascaras).forEach(([mascara, esperado]) => {
                test(`versao ${vetor.versao}, mascara ${mascara} — ${rotulo}`, () => {
                    const gerado = qrcode.gerarMatriz(vetor.texto, { mascara: Number(mascara) });
                    expect(comoLinhas(gerado.modulos)).toEqual(esperado);
                });
            });
        });
    });

    describe('escolha de versao', () => {
        test('cresce conforme o texto e nunca escolhe versao maior que a necessaria', () => {
            expect(qrcode.escolherVersao(1)).toBe(1);
            // Limite exato da versao 1 no nivel M: 14 bytes.
            expect(qrcode.escolherVersao(14)).toBe(1);
            expect(qrcode.escolherVersao(15)).toBe(2);
            expect(qrcode.escolherVersao(213)).toBe(qrcode.VERSAO_MAXIMA);
        });

        test('texto acima da capacidade falha alto, em vez de truncar em silencio', () => {
            expect(() => qrcode.escolherVersao(214)).toThrow(/longo demais/i);
            expect(() => qrcode.gerarMatriz('x'.repeat(400))).toThrow(/longo demais/i);
        });

        test('conta bytes UTF-8, nao caracteres', () => {
            // 'ç' ocupa 2 bytes: 107 acentos passam de 213 bytes.
            expect(() => qrcode.gerarMatriz('ç'.repeat(107))).toThrow(/longo demais/i);
            expect(qrcode.gerarMatriz('ç'.repeat(100)).versao).toBe(qrcode.VERSAO_MAXIMA);
        });
    });

    describe('padroes obrigatorios da norma', () => {
        const { modulos, tamanho } = qrcode.gerarMatriz('https://unieuro.edu.br/grades/');

        test('os tres localizadores estao nos cantos', () => {
            [
                [0, 0],
                [0, tamanho - 7],
                [tamanho - 7, 0],
            ].forEach(([linha, coluna]) => {
                expect(modulos[linha][coluna]).toBe(1);
                expect(modulos[linha + 1][coluna + 1]).toBe(0);
                expect(modulos[linha + 3][coluna + 3]).toBe(1);
            });
        });

        test('o modulo sempre escuro esta no lugar', () => {
            expect(modulos[tamanho - 8][8]).toBe(1);
        });

        test('as linhas de temporizacao alternam', () => {
            for (let i = 8; i < tamanho - 8; i += 1) {
                expect(modulos[6][i]).toBe(i % 2 === 0 ? 1 : 0);
                expect(modulos[i][6]).toBe(i % 2 === 0 ? 1 : 0);
            }
        });
    });

    describe('saida SVG', () => {
        const url = 'https://unieuro.edu.br/grades/?campus=1&curso=7';

        test('e um SVG bem formado com a margem de silencio da norma', () => {
            const svg = qrcode.paraSvg(url);
            const { tamanho } = qrcode.gerarMatriz(url);

            expect(svg.startsWith('<svg ')).toBe(true);
            expect(svg.endsWith('</svg>')).toBe(true);
            // 4 modulos de margem de cada lado; sem eles a camera do celular erra.
            expect(svg).toContain(`viewBox="0 0 ${tamanho + 8} ${tamanho + 8}"`);
        });

        test('sem titulo, e decorativo; com titulo, e anunciado', () => {
            expect(qrcode.paraSvg(url)).toContain('aria-hidden="true"');

            const comTitulo = qrcode.paraSvg(url, { titulo: 'Grade completa' });
            expect(comTitulo).toContain('<title>Grade completa</title>');
            expect(comTitulo).not.toContain('aria-hidden');
        });

        test('escapa o titulo, que e o unico texto externo do markup', () => {
            const svg = qrcode.paraSvg(url, { titulo: 'A & B <script>' });
            expect(svg).toContain('A &amp; B &lt;script&gt;');
            expect(svg).not.toContain('<script>');
        });

        test('e deterministico: mesma entrada, mesma saida', () => {
            expect(qrcode.paraSvg(url)).toBe(qrcode.paraSvg(url));
        });
    });
});
