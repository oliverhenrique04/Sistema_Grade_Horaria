/**
 * Regras de negocio de campus.
 *
 * Campus e entidade estrutural com historico (locais e turmas apontam para ele),
 * por isso a acao padrao e INATIVAR. A exclusao real so acontece quando nao ha
 * nenhum vinculo; qualquer violacao de chave estrangeira que escape e traduzida
 * em `ErroDependencia`.
 */
const campusRepository = require('../repositories/campusRepository');
const paginacaoUtil = require('../utils/paginacao');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    ErroNaoEncontrado,
} = require('../utils/erros');

/**
 * Traduz erros do PostgreSQL em erros de dominio com mensagem em portugues.
 * Erros desconhecidos voltam intactos para o tratador global.
 * @param {any} erro
 * @returns {Error}
 */
const traduzirErroBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === '23505') {
        if (erro.constraint === 'uq_campus_nome') {
            return new ErroValidacao('Verifique os campos destacados.', {
                nome: 'Já existe um campus com este nome.',
            });
        }
        return new ErroConflito('Já existe um campus com estes dados.');
    }

    if (erro.code === '23503') {
        return new ErroDependencia(
            'Este campus possui registros vinculados e não pode ser excluído. Inative-o.'
        );
    }

    return erro;
};

/**
 * Descreve os vinculos existentes em texto legivel ("2 locais e 1 turma").
 * @param {{locais:number, turmas:number, cursos:number, usuarios:number}} vinculos
 * @returns {string}
 */
const descreverVinculos = (vinculos) => {
    const partes = [];
    if (vinculos.locais > 0) {
        partes.push(`${vinculos.locais} ${vinculos.locais === 1 ? 'local' : 'locais'}`);
    }
    if (vinculos.turmas > 0) {
        partes.push(`${vinculos.turmas} ${vinculos.turmas === 1 ? 'turma' : 'turmas'}`);
    }
    if (vinculos.cursos > 0) {
        partes.push(`${vinculos.cursos} ${vinculos.cursos === 1 ? 'curso' : 'cursos'}`);
    }
    if (vinculos.usuarios > 0) {
        partes.push(`${vinculos.usuarios} ${vinculos.usuarios === 1 ? 'usuário' : 'usuários'}`);
    }
    if (partes.length === 0) return '';
    if (partes.length === 1) return partes[0];
    return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
};

/**
 * Lista campus com paginacao.
 * @param {{busca?:string|null, ativo?:boolean|null, pagina?:number, porPagina?:number}} [opcoes]
 * @returns {Promise<{itens:object[], paginacao:object}>}
 */
const listar = async ({ busca = null, ativo = null, pagina = 1, porPagina = 20 } = {}) => {
    const total = await campusRepository.contar({ busca, ativo });
    const paginacao = paginacaoUtil.montar({ pagina, porPagina }, total);

    const itens = await campusRepository.listar({
        busca,
        ativo,
        limite: paginacao.porPagina,
        offset: paginacao.offset,
    });

    return { itens, paginacao };
};

/**
 * Carrega um campus ou lanca `ErroNaoEncontrado`.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
const obter = async (id) => {
    const campus = await campusRepository.buscarPorId(id);
    if (!campus) throw new ErroNaoEncontrado('Campus não encontrado.');
    return campus;
};

/**
 * Garante que o nome nao esta em uso por outro campus.
 * @param {string} nome
 * @param {number|null} [ignorarId]
 * @returns {Promise<void>}
 */
const garantirNomeDisponivel = async (nome, ignorarId = null) => {
    const existente = await campusRepository.buscarPorNome(nome, ignorarId);
    if (existente) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            nome: 'Já existe um campus com este nome.',
        });
    }
};

/**
 * Cria um campus.
 * @param {{nome:string, sigla:string|null, ativo:boolean}} dados ja validados
 * @returns {Promise<object>}
 */
const criar = async (dados) => {
    await garantirNomeDisponivel(dados.nome);

    try {
        // Campo a campo: nada alem do que o validator devolveu chega ao banco.
        return await campusRepository.inserir({
            nome: dados.nome,
            sigla: dados.sigla,
            ativo: dados.ativo,
        });
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Um campus com turmas ativas continua em uso na grade: inativa-lo esconderia
 * turmas em andamento, por isso a operacao e recusada com explicacao.
 * @param {object} campus
 * @returns {Promise<void>}
 */
const garantirPodeInativar = async (campus) => {
    const vinculos = await campusRepository.contarVinculos(campus.id);
    if (vinculos.turmasAtivas > 0) {
        throw new ErroDependencia(
            `Não é possível inativar o campus "${campus.nome}": existem ` +
                `${vinculos.turmasAtivas} turma(s) ativa(s) vinculada(s) a ele. ` +
                'Inative ou transfira essas turmas antes.'
        );
    }
};

/**
 * Atualiza um campus.
 * @param {number|string} id
 * @param {{nome:string, sigla:string|null, ativo:boolean}} dados ja validados
 * @returns {Promise<object>}
 */
const atualizar = async (id, dados) => {
    const campus = await obter(id);
    await garantirNomeDisponivel(dados.nome, campus.id);

    if (campus.ativo && !dados.ativo) {
        await garantirPodeInativar(campus);
    }

    try {
        const atualizado = await campusRepository.atualizar(campus.id, {
            nome: dados.nome,
            sigla: dados.sigla,
            ativo: dados.ativo,
        });
        if (!atualizado) throw new ErroNaoEncontrado('Campus não encontrado.');
        return atualizado;
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Ativa ou inativa um campus.
 * @param {number|string} id
 * @param {boolean} ativo
 * @returns {Promise<object>}
 */
const definirAtivo = async (id, ativo) => {
    const campus = await obter(id);
    if (!ativo) await garantirPodeInativar(campus);

    const atualizado = await campusRepository.definirAtivo(campus.id, ativo);
    if (!atualizado) throw new ErroNaoEncontrado('Campus não encontrado.');
    return atualizado;
};

/**
 * Exclui um campus sem nenhum vinculo. Com vinculos, orienta a inativacao.
 * @param {number|string} id
 * @returns {Promise<object>} o campus removido
 */
const excluir = async (id) => {
    const campus = await obter(id);
    const vinculos = await campusRepository.contarVinculos(campus.id);

    if (vinculos.total > 0) {
        throw new ErroDependencia(
            `Não é possível excluir o campus "${campus.nome}": há registros vinculados a ele ` +
                `(${descreverVinculos(vinculos)}). Inative o campus em vez de excluí-lo.`
        );
    }

    try {
        const removido = await campusRepository.excluir(campus.id);
        if (!removido) throw new ErroNaoEncontrado('Campus não encontrado.');
        return campus;
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

module.exports = {
    listar,
    obter,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    descreverVinculos,
};
