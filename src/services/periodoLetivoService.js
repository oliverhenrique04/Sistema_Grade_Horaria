/**
 * Regras de negocio dos periodos letivos.
 *
 * Responsabilidades:
 *  - validar o corpo do formulario (delegando ao schema Zod, que tambem deduz
 *    ano/semestre a partir de codigos no formato "2026.1");
 *  - garantir a unicidade do codigo com mensagem por campo;
 *  - manter a regra de "no maximo um periodo atual" sem deixar o indice unico
 *    parcial do banco (`ux_periodo_letivo_atual`) estourar erro 500 — a troca
 *    acontece dentro de uma transacao no repositorio;
 *  - impedir inativacao/exclusao de periodo que ja tenha turmas.
 */
const periodoLetivoRepository = require('../repositories/periodoLetivoRepository');
const { validarPeriodo, validarFiltros } = require('../validators/periodoLetivo');
const { ErroNaoEncontrado, ErroValidacao, ErroDependencia } = require('../utils/erros');

const UNICIDADE = '23505';
const DEPENDENCIA = '23503';

const MENSAGEM_CODIGO_DUPLICADO = 'Já existe um período letivo com este código.';

/**
 * Converte erros do PostgreSQL em erros de dominio legiveis.
 * @param {any} erro
 * @returns {any}
 */
const traduzirErroDoBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === UNICIDADE) {
        // O unico outro indice unico da tabela e o de "periodo atual"; a troca ja
        // e feita em transacao, mas a mensagem cobre a corrida entre requisicoes.
        const campo =
            erro.constraint === 'ux_periodo_letivo_atual'
                ? {
                      atual: 'Outro período foi marcado como atual. Recarregue a página e tente de novo.',
                  }
                : { codigo: MENSAGEM_CODIGO_DUPLICADO };
        return new ErroValidacao('Verifique os campos destacados.', campo);
    }

    if (erro.code === DEPENDENCIA) {
        return new ErroDependencia(
            'Este período letivo possui turmas vinculadas e não pode ser excluído. Inative-o.'
        );
    }

    return erro;
};

/**
 * @param {unknown} valor
 * @returns {number}
 * @throws {ErroNaoEncontrado}
 */
const lerId = (valor) => {
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ErroNaoEncontrado('Período letivo não encontrado.');
    }
    return id;
};

/**
 * Lista periodos com filtros e paginacao.
 * @param {Record<string, unknown>} query
 * @param {{limite:number, offset:number}} paginacao
 * @returns {Promise<{itens:object[], total:number, filtros:object}>}
 */
const listar = async (query = {}, { limite, offset }) => {
    const filtros = validarFiltros(query);
    const [itens, total] = await Promise.all([
        periodoLetivoRepository.listar(filtros, { limite, offset }),
        periodoLetivoRepository.contar(filtros),
    ]);
    return { itens, total, filtros };
};

/**
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 */
const obter = async (idBruto) => {
    const periodo = await periodoLetivoRepository.buscarPorId(lerId(idBruto));
    if (!periodo) throw new ErroNaoEncontrado('Período letivo não encontrado.');
    return periodo;
};

/**
 * Garante que nenhum outro periodo use o mesmo codigo.
 * @param {string} codigo
 * @param {number|null} ignorarId
 */
const garantirCodigoUnico = async (codigo, ignorarId = null) => {
    const existente = await periodoLetivoRepository.buscarPorCodigo(codigo, ignorarId);
    if (existente) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            codigo: MENSAGEM_CODIGO_DUPLICADO,
        });
    }
};

/**
 * Cria um periodo letivo.
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<object>}
 */
const criar = async (corpo) => {
    const dados = validarPeriodo(corpo);
    await garantirCodigoUnico(dados.codigo);

    try {
        return await periodoLetivoRepository.criar(dados);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Atualiza um periodo letivo.
 * @param {unknown} idBruto
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<object>}
 */
const atualizar = async (idBruto, corpo) => {
    const id = lerId(idBruto);
    const atual = await periodoLetivoRepository.buscarPorId(id);
    if (!atual) throw new ErroNaoEncontrado('Período letivo não encontrado.');

    const dados = validarPeriodo(corpo);
    await garantirCodigoUnico(dados.codigo, id);

    if (atual.ativo && !dados.ativo && atual.total_turmas > 0) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            ativo: `Não é possível inativar: o período possui ${atual.total_turmas} turma(s).`,
        });
    }

    try {
        const periodo = await periodoLetivoRepository.atualizar(id, dados);
        if (!periodo) throw new ErroNaoEncontrado('Período letivo não encontrado.');
        return periodo;
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Marca o periodo como atual (e desmarca o anterior na mesma transacao).
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 */
const definirAtual = async (idBruto) => {
    const id = lerId(idBruto);

    try {
        const periodo = await periodoLetivoRepository.definirAtual(id);
        if (!periodo) throw new ErroNaoEncontrado('Período letivo não encontrado.');
        return periodo;
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Ativa ou inativa um periodo. Inativar exige que nao existam turmas.
 * @param {unknown} idBruto
 * @param {boolean} ativo
 * @returns {Promise<object>}
 */
const definirAtivo = async (idBruto, ativo) => {
    const id = lerId(idBruto);
    const periodo = await periodoLetivoRepository.buscarPorId(id);
    if (!periodo) throw new ErroNaoEncontrado('Período letivo não encontrado.');

    if (!ativo) {
        const vinculos = await periodoLetivoRepository.contarVinculos(id);
        if (vinculos.turmas > 0) {
            throw new ErroDependencia(
                `Não é possível inativar "${periodo.codigo}": existem ${vinculos.turmas} turma(s) neste período.`
            );
        }
    }

    return periodoLetivoRepository.definirAtivo(id, ativo);
};

/**
 * Exclui um periodo letivo. So e permitido quando nao ha turmas vinculadas.
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 */
const excluir = async (idBruto) => {
    const id = lerId(idBruto);
    const periodo = await periodoLetivoRepository.buscarPorId(id);
    if (!periodo) throw new ErroNaoEncontrado('Período letivo não encontrado.');

    const vinculos = await periodoLetivoRepository.contarVinculos(id);
    if (vinculos.turmas > 0) {
        throw new ErroDependencia(
            `Não é possível excluir "${periodo.codigo}": há ${vinculos.turmas} turma(s) vinculada(s). Inative o período.`
        );
    }

    try {
        await periodoLetivoRepository.excluir(id);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }

    return periodo;
};

/**
 * Anos ja cadastrados, para o filtro da listagem.
 * @returns {Promise<number[]>}
 */
const listarAnos = () => periodoLetivoRepository.listarAnos();

module.exports = {
    listar,
    obter,
    criar,
    atualizar,
    definirAtual,
    definirAtivo,
    excluir,
    listarAnos,
    lerId,
};
