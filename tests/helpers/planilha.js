/**
 * Gerador minimo de .xlsx para os testes.
 *
 * Escrever a planilha aqui (em vez de versionar um arquivo binario) mantem o
 * caso de teste legivel no diff e permite montar cenarios sob medida: turma
 * gerencial, co-docencia, faixa de horario fora do padrao. Produz um ZIP com
 * entradas armazenadas (sem compressao), que e o formato mais simples que o
 * leitor de `src/utils/planilha.js` precisa aceitar.
 *
 * Uso:
 *   const { montarXlsx } = require('./helpers/planilha');
 *   const arquivo = montarXlsx(['A', 'B'], [['1', '2']]);
 */
const zlib = require('node:zlib');

/** Escapa texto para conteudo XML. */
const escapar = (valor) =>
    String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/** Indice da coluna (0) para a letra do Excel ("A", "B", ..., "AA"). */
const letraDaColuna = (indice) => {
    let numero = indice + 1;
    let letra = '';
    while (numero > 0) {
        const resto = (numero - 1) % 26;
        letra = String.fromCharCode(65 + resto) + letra;
        numero = Math.floor((numero - 1) / 26);
    }
    return letra;
};

/**
 * Monta uma entrada ZIP armazenada (metodo 0).
 * @param {string} nome
 * @param {Buffer} conteudo
 * @returns {{local:Buffer, central:(offset:number)=>Buffer, tamanhoLocal:number}}
 */
const entradaZip = (nome, conteudo) => {
    const nomeBuffer = Buffer.from(nome, 'utf8');
    const crc = zlib.crc32(conteudo);

    const local = Buffer.alloc(30 + nomeBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versao minima
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // metodo: stored
    local.writeUInt16LE(0, 10); // hora
    local.writeUInt16LE(0x21, 12); // data (01/01/1980)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nomeBuffer.copy(local, 30);

    const central = (offset) => {
        const registro = Buffer.alloc(46 + nomeBuffer.length);
        registro.writeUInt32LE(0x02014b50, 0);
        registro.writeUInt16LE(20, 4);
        registro.writeUInt16LE(20, 6);
        registro.writeUInt16LE(0, 8);
        registro.writeUInt16LE(0, 10);
        registro.writeUInt16LE(0, 12);
        registro.writeUInt16LE(0x21, 14);
        registro.writeUInt32LE(crc, 16);
        registro.writeUInt32LE(conteudo.length, 20);
        registro.writeUInt32LE(conteudo.length, 24);
        registro.writeUInt16LE(nomeBuffer.length, 28);
        registro.writeUInt16LE(0, 30);
        registro.writeUInt16LE(0, 32);
        registro.writeUInt16LE(0, 34);
        registro.writeUInt16LE(0, 36);
        registro.writeUInt32LE(0, 38);
        registro.writeUInt32LE(offset, 42);
        nomeBuffer.copy(registro, 46);
        return registro;
    };

    return { local, conteudo, central };
};

/**
 * Empacota as entradas em um Buffer ZIP.
 * @param {Array<{nome:string, conteudo:Buffer}>} arquivos
 * @returns {Buffer}
 */
const zipar = (arquivos) => {
    const partes = [];
    const centrais = [];
    let offset = 0;

    arquivos.forEach(({ nome, conteudo }) => {
        const entrada = entradaZip(nome, conteudo);
        centrais.push(entrada.central(offset));
        partes.push(entrada.local, entrada.conteudo);
        offset += entrada.local.length + entrada.conteudo.length;
    });

    const inicioDiretorio = offset;
    const diretorio = Buffer.concat(centrais);

    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(0, 4);
    fim.writeUInt16LE(0, 6);
    fim.writeUInt16LE(centrais.length, 8);
    fim.writeUInt16LE(centrais.length, 10);
    fim.writeUInt32LE(diretorio.length, 12);
    fim.writeUInt32LE(inicioDiretorio, 16);
    fim.writeUInt16LE(0, 20);

    return Buffer.concat([...partes, diretorio, fim]);
};

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

/**
 * Monta um .xlsx com uma unica aba.
 *
 * Valores `number` viram celula numerica; qualquer outro valor vira texto. Os
 * textos vao para `sharedStrings`, como faz o Excel — e como vem a exportacao
 * do cubo — para que o teste exercite esse caminho do leitor.
 *
 * @param {string[]} cabecalho titulos das colunas
 * @param {Array<Array<any>>} linhas valores, na ordem do cabecalho
 * @returns {Buffer} conteudo do arquivo
 */
const montarXlsx = (cabecalho, linhas = []) => {
    const textos = [];
    const indiceDoTexto = new Map();

    const referenciarTexto = (valor) => {
        if (!indiceDoTexto.has(valor)) {
            indiceDoTexto.set(valor, textos.length);
            textos.push(valor);
        }
        return indiceDoTexto.get(valor);
    };

    const montarLinha = (valores, numero) => {
        const celulas = valores
            .map((valor, coluna) => {
                if (valor === null || valor === undefined || valor === '') return '';
                const referencia = `${letraDaColuna(coluna)}${numero}`;

                if (typeof valor === 'number') {
                    return `<c r="${referencia}"><v>${valor}</v></c>`;
                }

                return `<c r="${referencia}" t="s"><v>${referenciarTexto(String(valor))}</v></c>`;
            })
            .join('');

        return `<row r="${numero}">${celulas}</row>`;
    };

    const corpo = [cabecalho, ...linhas]
        .map((valores, indice) => montarLinha(valores, indice + 1))
        .join('');

    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${corpo}</sheetData></worksheet>`;

    const compartilhados = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${textos.length}" uniqueCount="${textos.length}">${textos
        .map((texto) => `<si><t>${escapar(texto)}</t></si>`)
        .join('')}</sst>`;

    return zipar([
        { nome: '[Content_Types].xml', conteudo: Buffer.from(CONTENT_TYPES, 'utf8') },
        { nome: '_rels/.rels', conteudo: Buffer.from(RELS, 'utf8') },
        { nome: 'xl/workbook.xml', conteudo: Buffer.from(WORKBOOK, 'utf8') },
        { nome: 'xl/_rels/workbook.xml.rels', conteudo: Buffer.from(WORKBOOK_RELS, 'utf8') },
        { nome: 'xl/sharedStrings.xml', conteudo: Buffer.from(compartilhados, 'utf8') },
        { nome: 'xl/worksheets/sheet1.xml', conteudo: Buffer.from(sheet, 'utf8') },
    ]);
};

/** Colunas do cubo de horarios, na ordem em que o TOTVS exporta. */
const COLUNAS_CUBO = [
    'CODCOLIGADA',
    'FILIAL',
    'CHAPA',
    'NOME',
    'DTINICIO_DISCIPLINA',
    'HORAINICIAL',
    'HORAFINAL',
    'TIPO_PROF',
    'DISCIPLINA',
    'TURNO DISCIPLINA',
    'CURSO',
    'TIPO_TUMA',
    'CODCURSO',
    'TURMA_GERENCIAL',
    'GERENCIADA',
    'CODTURMA_GERENCIAL',
    'IDTURMADISC_GEREN',
    'CODTURMA',
    'IDTURMADISC',
    'CODDISC',
    'DTFIM_DISCIPLINA',
    'CH_DISPLINA',
    'SEMANA',
    'AULAS_SEMANA',
    'TOTAL_HORAS',
];

/** Valores padrao de uma linha do cubo, sobrescritos pelo que o teste informar. */
const LINHA_PADRAO = {
    CODCOLIGADA: 2,
    FILIAL: 'EUROAM - AGUAS CLARAS',
    CHAPA: '000100',
    NOME: 'PROFESSOR DE TESTE',
    DTINICIO_DISCIPLINA: '10/08/2026',
    HORAINICIAL: '08:00',
    HORAFINAL: '08:50',
    TIPO_PROF: 'Titular',
    DISCIPLINA: 'DISCIPLINA DE TESTE',
    'TURNO DISCIPLINA': 'MATUTINO',
    CURSO: 'DIREITO',
    TIPO_TUMA: 'Presencial',
    CODCURSO: '10006',
    TURMA_GERENCIAL: 'Não',
    GERENCIADA: 'NÃO',
    CODTURMA_GERENCIAL: null,
    IDTURMADISC_GEREN: null,
    CODTURMA: 'DIR01M1',
    IDTURMADISC: 900001,
    CODDISC: '1.000001.040',
    DTFIM_DISCIPLINA: '19/12/2026',
    CH_DISPLINA: 40,
    SEMANA: 'Segunda-Feira',
    // Sem quantidade declarada toda aula entra presencial — e o que faziam as
    // exportacoes anteriores a coluna AULAS_SEMANA.
    AULAS_SEMANA: null,
    TOTAL_HORAS: null,
};

/**
 * Monta uma planilha no formato do cubo a partir de linhas parciais.
 * @param {Array<Record<string, any>>} linhas sobrescritas de `LINHA_PADRAO`
 * @returns {Buffer}
 */
const montarCubo = (linhas) =>
    montarXlsx(
        COLUNAS_CUBO,
        linhas.map((linha) => {
            const completa = { ...LINHA_PADRAO, ...linha };
            return COLUNAS_CUBO.map((coluna) => completa[coluna]);
        })
    );

module.exports = { montarXlsx, montarCubo, COLUNAS_CUBO, LINHA_PADRAO };
