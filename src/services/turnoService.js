/**
 * Regras de negocio de turnos.
 *
 * A quantidade de horarios de um turno e livre (definida em `horarios_turno`);
 * nada aqui limita esse numero. Turnos com horarios cadastrados ou turmas
 * vinculadas nao podem ser excluidos nem inativados: a grade depende deles.
 */
const turnoRepository = require('../repositories/turnoRepository');
const paginacaoUtil = require('../utils/paginacao');
const { gerarSlug } = require('../validators/turno');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    ErroNaoEncontrado,
} = require('../utils/erros');

/**
 * Traduz erros do PostgreSQL em erros de dominio.
 * @param {any} erro
 * @returns {Error}
 */
const traduzirErroBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === '23505') {
        if (erro.constraint === 'uq_turno_nome') {
            return new ErroValidacao('Verifique os campos destacados.', {
                nome: 'Já existe um turno com este nome.',
            });
        }
        if (erro.constraint === 'uq_turno_slug') {
            return new ErroValidacao('Verifique os campos destacados.', {
                slug: 'Já existe um turno com este identificador.',
            });
        }
        return new ErroConflito('Já existe um turno com estes dados.');
    }

    if (erro.code === '23503') {
        return new ErroDependencia(
            'Este turno possui registros vinculados e não pode ser excluído. Inative-o.'
        );
    }

    return erro;
};

/**
 * Lista turnos com paginacao (cada item traz `total_horarios`).
 * @param {{busca?:string|null, ativo?:boolean|null, pagina?:number, porPagina?:number}} [opcoes]
 * @returns {Promise<{itens:object[], paginacao:object}>}
 */
const listar = async ({ busca = null, ativo = null, pagina = 1, porPagina = 20 } = {}) => {
    const total = await turnoRepository.contar({ busca, ativo });
    const paginacao = paginacaoUtil.montar({ pagina, porPagina }, total);

    const itens = await turnoRepository.listar({
        busca,
        ativo,
        limite: paginacao.porPagina,
        offset: paginacao.offset,
    });

    return { itens, paginacao };
};

/**
 * @param {number|string} id
 * @returns {Promise<object>}
 * @throws {ErroNaoEncontrado}
 */
const obter = async (id) => {
    const turno = await turnoRepository.buscarPorId(id);
    if (!turno) throw new ErroNaoEncontrado('Turno não encontrado.');
    return turno;
};

/**
 * Lista turnos para selects (usada tambem pelo CRUD de horarios).
 * @param {{apenasAtivos?:boolean, incluirId?:number|null}} [opcoes]
 * @returns {Promise<object[]>}
 */
const listarParaSelecao = (opcoes = {}) => turnoRepository.listarParaSelecao(opcoes);

/**
 * Resolve o slug definitivo e garante que nome e slug estao livres.
 * @param {{nome:string, slug:string}} dados
 * @param {number|null} [ignorarId]
 * @returns {Promise<string>} slug final
 */
const resolverIdentificadores = async (dados, ignorarId = null) => {
    const slug = dados.slug || gerarSlug(dados.nome);

    if (!slug) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            slug: 'Não foi possível gerar o identificador a partir do nome. Informe-o manualmente.',
        });
    }

    const [porNome, porSlug] = await Promise.all([
        turnoRepository.buscarPorNome(dados.nome, ignorarId),
        turnoRepository.buscarPorSlug(slug, ignorarId),
    ]);

    if (porNome) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            nome: 'Já existe um turno com este nome.',
        });
    }

    if (porSlug) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            slug: 'Já existe um turno com este identificador.',
        });
    }

    return slug;
};

/**
 * Cria um turno.
 * @param {object} dados ja validados
 * @returns {Promise<object>}
 */
const criar = async (dados) => {
    const slug = await resolverIdentificadores(dados);

    try {
        return await turnoRepository.inserir({
            nome: dados.nome,
            slug,
            icone: dados.icone,
            tema_class: dados.tema_class,
            ordem: dados.ordem,
            ativo: dados.ativo,
        });
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Turnos usados por turmas nao podem sair de circulacao: a grade dessas turmas
 * depende do turno e dos horarios dele.
 * @param {object} turno
 * @param {'inativar'|'excluir'} acao
 * @returns {Promise<void>}
 */
const garantirSemTurmas = async (turno, acao) => {
    const vinculos = await turnoRepository.contarVinculos(turno.id);
    if (vinculos.turmas > 0) {
        throw new ErroDependencia(
            `Não é possível ${acao} o turno "${turno.nome}": há ${vinculos.turmas} turma(s) ` +
                'vinculada(s) a ele. Altere o turno dessas turmas antes.'
        );
    }
};

/**
 * Atualiza um turno.
 * @param {number|string} id
 * @param {object} dados ja validados
 * @returns {Promise<object>}
 */
const atualizar = async (id, dados) => {
    const turno = await obter(id);
    const slug = await resolverIdentificadores(dados, turno.id);

    if (turno.ativo && !dados.ativo) {
        await garantirSemTurmas(turno, 'inativar');
    }

    try {
        const atualizado = await turnoRepository.atualizar(turno.id, {
            nome: dados.nome,
            slug,
            icone: dados.icone,
            tema_class: dados.tema_class,
            ordem: dados.ordem,
            ativo: dados.ativo,
        });
        if (!atualizado) throw new ErroNaoEncontrado('Turno não encontrado.');
        return atualizado;
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Ativa ou inativa um turno.
 * @param {number|string} id
 * @param {boolean} ativo
 * @returns {Promise<object>}
 */
const definirAtivo = async (id, ativo) => {
    const turno = await obter(id);
    if (!ativo) await garantirSemTurmas(turno, 'inativar');

    const atualizado = await turnoRepository.definirAtivo(turno.id, ativo);
    if (!atualizado) throw new ErroNaoEncontrado('Turno não encontrado.');
    return atualizado;
};

/**
 * Exclui um turno sem horarios nem turmas.
 * @param {number|string} id
 * @returns {Promise<object>} o turno removido
 */
const excluir = async (id) => {
    const turno = await obter(id);
    const vinculos = await turnoRepository.contarVinculos(turno.id);

    if (vinculos.turmas > 0) {
        throw new ErroDependencia(
            `Não é possível excluir o turno "${turno.nome}": há ${vinculos.turmas} turma(s) ` +
                'vinculada(s) a ele. Inative o turno em vez de excluí-lo.'
        );
    }

    if (vinculos.horarios > 0) {
        throw new ErroDependencia(
            `Não é possível excluir o turno "${turno.nome}": ele possui ` +
                `${vinculos.horarios} horário(s) cadastrado(s). Exclua os horários antes ` +
                'ou apenas inative o turno.'
        );
    }

    try {
        const removido = await turnoRepository.excluir(turno.id);
        if (!removido) throw new ErroNaoEncontrado('Turno não encontrado.');
        return turno;
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

module.exports = {
    listar,
    obter,
    listarParaSelecao,
    criar,
    atualizar,
    definirAtivo,
    excluir,
};
