/**
 * Guarda temporariamente a planilha enviada, entre a previa e a confirmacao.
 *
 * O operador envia o arquivo uma vez, confere o relatorio da simulacao e so
 * entao confirma a gravacao. Manter o arquivo no servidor evita pedir o mesmo
 * upload duas vezes — o que, num arquivo de meio megabyte e numa tela de
 * conferencia, e a diferenca entre revisar com calma e desistir da conferencia.
 *
 * Cuidados:
 *  - o identificador e um UUID gerado aqui; o valor que chega pela URL e
 *    validado contra o formato antes de virar caminho, entao nao ha como
 *    escapar do diretorio;
 *  - o nome original do arquivo viaja em um `.json` ao lado, nunca no caminho;
 *  - arquivos com mais de algumas horas sao descartados a cada novo envio, para
 *    que planilhas abandonadas nao se acumulem no disco.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ErroNaoEncontrado } = require('../../utils/erros');

const DIRETORIO = path.resolve(__dirname, '..', '..', '..', 'storage', 'importacoes');

/** Tempo de vida de um envio nao confirmado. */
const VALIDADE_MS = 6 * 60 * 60 * 1000;

/** Formato aceito para o identificador vindo da URL. */
const FORMATO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Caminho do envio, ja validado contra travessia de diretorio.
 * @param {string} id
 * @param {string} extensao
 * @returns {string}
 */
const caminho = (id, extensao) => {
    if (!FORMATO_ID.test(String(id || ''))) {
        throw new ErroNaoEncontrado('Envio não encontrado.');
    }
    return path.join(DIRETORIO, `${id}${extensao}`);
};

/**
 * Remove envios vencidos. Falhas aqui nao interrompem a importacao.
 * @returns {Promise<void>}
 */
const limparVencidos = async () => {
    try {
        const arquivos = await fs.readdir(DIRETORIO);
        const limite = Date.now() - VALIDADE_MS;

        await Promise.all(
            arquivos.map(async (nome) => {
                const alvo = path.join(DIRETORIO, nome);
                const info = await fs.stat(alvo).catch(() => null);
                if (info && info.mtimeMs < limite) await fs.rm(alvo, { force: true });
            })
        );
    } catch {
        // Diretorio ainda nao existe ou esta indisponivel: nada a limpar.
    }
};

/**
 * Guarda a planilha e devolve o identificador do envio.
 * @param {{nome:string, conteudo:Buffer}} arquivo
 * @returns {Promise<string>}
 */
const guardar = async (arquivo) => {
    await fs.mkdir(DIRETORIO, { recursive: true });
    await limparVencidos();

    const id = crypto.randomUUID();

    await fs.writeFile(caminho(id, '.xlsx'), arquivo.conteudo);
    await fs.writeFile(
        caminho(id, '.json'),
        JSON.stringify({
            nome: arquivo.nome,
            tamanho: arquivo.tamanho,
            em: new Date().toISOString(),
        })
    );

    return id;
};

/**
 * Recupera um envio guardado.
 * @param {string} id
 * @returns {Promise<{nome:string, conteudo:Buffer}>}
 * @throws {ErroNaoEncontrado} quando o envio expirou ou nunca existiu
 */
const recuperar = async (id) => {
    const arquivo = caminho(id, '.xlsx');
    const conteudo = await fs.readFile(arquivo).catch(() => null);

    if (!conteudo) {
        throw new ErroNaoEncontrado(
            'O envio expirou ou já foi processado. Envie a planilha novamente.'
        );
    }

    const bruto = await fs.readFile(caminho(id, '.json'), 'utf8').catch(() => '{}');
    let dados;
    try {
        dados = JSON.parse(bruto);
    } catch {
        // Metadado ilegivel nao invalida o envio: o que importa e a planilha.
        dados = {};
    }

    return { nome: dados.nome || 'planilha.xlsx', tamanho: conteudo.length, conteudo };
};

/**
 * Descarta um envio ja processado.
 * @param {string} id
 * @returns {Promise<void>}
 */
const descartar = async (id) => {
    await Promise.all([
        fs.rm(caminho(id, '.xlsx'), { force: true }).catch(() => {}),
        fs.rm(caminho(id, '.json'), { force: true }).catch(() => {}),
    ]);
};

module.exports = { guardar, recuperar, descartar, limparVencidos, DIRETORIO };
