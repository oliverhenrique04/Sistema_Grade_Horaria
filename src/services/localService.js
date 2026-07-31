/**
 * Regras de negocio de locais (salas, laboratorios, auditorios...).
 *
 * Escopo: o perfil `nap` so enxerga e so mantem locais dos campus vinculados a
 * ele (`usuario_campus`). `admin` e `coordenador` nao sao limitados por campus
 * — o coordenador e limitado por curso, eixo que nao se aplica a locais. Essa e
 * exatamente a semantica de `podeAcessarCampus`, usada aqui como fonte unica.
 *
 * `aulas.local_id` e ON DELETE SET NULL: o banco nao impede excluir um local em
 * uso, entao a checagem em `emUso()` e obrigatoria antes de qualquer exclusao.
 */
const localRepository = require('../repositories/localRepository');
const campusRepository = require('../repositories/campusRepository');
const paginacaoUtil = require('../utils/paginacao');
const { podeAcessarCampus } = require('../middlewares/autorizacao');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    ErroNaoEncontrado,
    ErroPermissao,
} = require('../utils/erros');

/**
 * Traduz erros do PostgreSQL em erros de dominio.
 * @param {any} erro
 * @returns {Error}
 */
const traduzirErroBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === '23505') {
        if (erro.constraint === 'uq_local_campus_nome') {
            return new ErroValidacao('Verifique os campos destacados.', {
                nome: 'Já existe um local com este nome neste campus.',
            });
        }
        return new ErroConflito('Já existe um local com estes dados.');
    }

    if (erro.code === '23514') {
        if (erro.constraint === 'ck_local_capacidade') {
            return new ErroValidacao('Verifique os campos destacados.', {
                capacidade: 'A capacidade não pode ser negativa.',
            });
        }
        if (erro.constraint === 'ck_local_tipo') {
            return new ErroValidacao('Verifique os campos destacados.', {
                tipo: 'Selecione um tipo de local válido.',
            });
        }
        return new ErroConflito('O local informado não atende às regras do sistema.');
    }

    if (erro.code === '23503') {
        return new ErroDependencia(
            'Este local está vinculado a outros registros e não pode ser excluído. Inative-o.'
        );
    }

    return erro;
};

/**
 * Campus que o usuario pode enxergar: `null` significa "sem restricao".
 * @param {{perfil?:string, campusIds?:number[]}|null} usuario
 * @returns {number[]|null}
 */
const campusDoEscopo = (usuario) => {
    if (!usuario || !usuario.perfil) return [];
    if (usuario.perfil === 'nap') return usuario.campusIds || [];
    return null;
};

/**
 * Recusa a operacao quando o campus esta fora do escopo do usuario.
 * @param {object} usuario
 * @param {number} campusId
 * @param {string} [acao]
 * @returns {void}
 * @throws {ErroPermissao}
 */
const garantirCampusNoEscopo = (usuario, campusId, acao = 'gerenciar locais deste campus') => {
    if (!podeAcessarCampus(usuario, campusId)) {
        throw new ErroPermissao(`Você não tem permissão para ${acao}.`);
    }
};

/**
 * Lista locais com paginacao, restritos ao escopo do usuario.
 * @param {{campusId?:number|null, tipo?:string|null, busca?:string|null,
 *          ativo?:boolean|null, pagina?:number, porPagina?:number}} [opcoes]
 * @param {object} usuario `req.usuario`
 * @returns {Promise<{itens:object[], paginacao:object}>}
 */
const listar = async (
    { campusId = null, tipo = null, busca = null, ativo = null, pagina = 1, porPagina = 20 } = {},
    usuario = null
) => {
    const campusIds = campusDoEscopo(usuario);
    const filtros = { campusId, tipo, busca, ativo, campusIds };

    const total = await localRepository.contar(filtros);
    const paginacao = paginacaoUtil.montar({ pagina, porPagina }, total);

    const itens = await localRepository.listar({
        campusId: filtros.campusId,
        tipo: filtros.tipo,
        busca: filtros.busca,
        ativo: filtros.ativo,
        campusIds: filtros.campusIds,
        limite: paginacao.porPagina,
        offset: paginacao.offset,
    });

    return { itens, paginacao };
};

/**
 * Carrega um local garantindo o escopo do usuario.
 * @param {number|string} id
 * @param {object} [usuario]
 * @returns {Promise<object>}
 */
const obter = async (id, usuario = null) => {
    const local = await localRepository.buscarPorId(id);
    if (!local) throw new ErroNaoEncontrado('Local não encontrado.');

    if (usuario && !podeAcessarCampus(usuario, local.campus_id)) {
        throw new ErroPermissao('Você não tem permissão para acessar este local.');
    }

    return local;
};

/**
 * Campus disponiveis para o formulario, respeitando o escopo do usuario.
 * @param {object} usuario
 * @param {number|null} [incluirId] campus ja vinculado ao registro em edicao
 * @returns {Promise<object[]>}
 */
const campusDisponiveis = (usuario, incluirId = null) =>
    campusRepository.listarParaSelecao({
        apenasAtivos: true,
        ids: campusDoEscopo(usuario),
        incluirId,
    });

/**
 * Garante que o campus existe, esta no escopo e que o nome esta livre nele.
 * @param {object} usuario
 * @param {{campus_id:number, nome:string}} dados
 * @param {number|null} [ignorarId]
 * @returns {Promise<void>}
 */
const garantirDadosCoerentes = async (usuario, dados, ignorarId = null) => {
    garantirCampusNoEscopo(usuario, dados.campus_id, 'cadastrar locais neste campus');

    const campus = await campusRepository.buscarPorId(dados.campus_id);
    if (!campus) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            campus_id: 'Selecione um campus válido.',
        });
    }

    const duplicado = await localRepository.buscarPorNomeNoCampus(
        dados.campus_id,
        dados.nome,
        ignorarId
    );

    if (duplicado) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            nome: 'Já existe um local com este nome neste campus.',
        });
    }
};

/**
 * Cria um local.
 * @param {{campus_id:number, nome:string, codigo:string|null, tipo:string,
 *          capacidade:number|null, ativo:boolean}} dados ja validados
 * @param {object} usuario
 * @returns {Promise<object>}
 */
const criar = async (dados, usuario) => {
    await garantirDadosCoerentes(usuario, dados);

    try {
        return await localRepository.inserir({
            campus_id: dados.campus_id,
            nome: dados.nome,
            codigo: dados.codigo,
            tipo: dados.tipo,
            capacidade: dados.capacidade,
            ativo: dados.ativo,
        });
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Atualiza um local. O campus atual e o novo precisam estar no escopo.
 * @param {number|string} id
 * @param {object} dados ja validados
 * @param {object} usuario
 * @returns {Promise<object>}
 */
const atualizar = async (id, dados, usuario) => {
    const local = await obter(id, usuario);
    await garantirDadosCoerentes(usuario, dados, local.id);

    try {
        const atualizado = await localRepository.atualizar(local.id, {
            campus_id: dados.campus_id,
            nome: dados.nome,
            codigo: dados.codigo,
            tipo: dados.tipo,
            capacidade: dados.capacidade,
            ativo: dados.ativo,
        });
        if (!atualizado) throw new ErroNaoEncontrado('Local não encontrado.');
        return atualizado;
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Ativa ou inativa um local.
 * @param {number|string} id
 * @param {boolean} ativo
 * @param {object} usuario
 * @returns {Promise<object>}
 */
const definirAtivo = async (id, ativo, usuario) => {
    const local = await obter(id, usuario);

    const atualizado = await localRepository.definirAtivo(local.id, ativo);
    if (!atualizado) throw new ErroNaoEncontrado('Local não encontrado.');
    return atualizado;
};

/**
 * Exclui um local nunca usado em aulas. Em uso, orienta a inativacao.
 * @param {number|string} id
 * @param {object} usuario
 * @returns {Promise<object>} o local removido
 */
const excluir = async (id, usuario) => {
    const local = await obter(id, usuario);
    const aulas = await localRepository.contarAulas(local.id);

    if (aulas > 0) {
        throw new ErroDependencia(
            `Não é possível excluir o local "${local.nome}": ele é usado em ${aulas} aula(s) ` +
                'da grade. Inative o local em vez de excluí-lo.'
        );
    }

    try {
        const removido = await localRepository.excluir(local.id);
        if (!removido) throw new ErroNaoEncontrado('Local não encontrado.');
        return local;
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
    campusDisponiveis,
    campusDoEscopo,
    garantirCampusNoEscopo,
};
