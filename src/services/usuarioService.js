/**
 * Regras de negocio de usuarios (CRUD administrativo).
 *
 * ACESSO: apenas o perfil `admin` chega ate aqui pelas rotas
 * (`exigirPerfil('admin')` + `exigirPermissao('usuarios', ...)`).
 *
 * Decisoes de seguranca:
 *  - a senha NUNCA e lida, devolvida ou registrada em log: entra em texto puro
 *    apenas para virar hash bcrypt em `autenticacaoService.gerarHash`;
 *  - o hash (`senha_hash`) nunca sai do repositorio para as views;
 *  - um administrador nao pode inativar nem rebaixar a si mesmo (evita o sistema
 *    ficar sem nenhum administrador por engano);
 *  - o ultimo administrador ativo nao pode ser inativado, rebaixado nem excluido;
 *  - os vinculos de escopo sao regravados junto com o usuario, na MESMA
 *    transacao, para nunca deixar o escopo pela metade.
 *
 * Todo o SQL fica em `repositories/usuarioRepository.js`.
 */
const db = require('../config/db');
const usuarioRepository = require('../repositories/usuarioRepository');
const autenticacaoService = require('./autenticacaoService');
const paginacaoUtil = require('../utils/paginacao');
const {
    ErroValidacao,
    ErroDependencia,
    ErroNaoEncontrado,
    ErroPermissao,
} = require('../utils/erros');

/** Violacao de unicidade no PostgreSQL. */
const CODIGO_UNICO = '23505';
/** Violacao de chave estrangeira no PostgreSQL. */
const CODIGO_FK = '23503';

/**
 * Traduz erros do banco em erros de aplicacao com mensagem por campo.
 * @param {Error & {code?:string}} erro
 * @returns {never}
 */
const traduzirErroDoBanco = (erro) => {
    if (erro && erro.code === CODIGO_UNICO) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            email: 'Já existe um usuário cadastrado com este e-mail.',
        });
    }

    if (erro && erro.code === CODIGO_FK) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            geral: 'Um dos cursos ou campus selecionados não existe mais. Recarregue a página e tente novamente.',
        });
    }

    throw erro;
};

/**
 * Listagem paginada de usuarios com o escopo (cursos/campus) e o ultimo login.
 * @param {{busca?:string, perfil?:string, ativo?:boolean|null,
 *          pagina?:number, porPagina?:number}} [filtros]
 * @returns {Promise<{itens:object[], paginacao:object}>}
 */
const listar = async (filtros = {}) => {
    const criterios = {
        busca: filtros.busca,
        perfil: filtros.perfil,
        ativo: filtros.ativo,
    };

    const total = await usuarioRepository.contar(criterios);
    const paginacao = paginacaoUtil.montar(
        { pagina: filtros.pagina || 1, porPagina: filtros.porPagina || 20 },
        total
    );

    const itens = await usuarioRepository.listar({
        ...criterios,
        limite: paginacao.porPagina,
        offset: paginacao.offset,
    });

    return { itens, paginacao };
};

/**
 * Carrega um usuario pelo id, ja com os ids de escopo resolvidos.
 * Nunca devolve o hash da senha.
 * @param {number} id
 * @returns {Promise<object>}
 * @throws {ErroNaoEncontrado}
 */
const obter = async (id) => {
    const usuario = await usuarioRepository.buscarPorId(id);
    if (!usuario) throw new ErroNaoEncontrado('Usuário não encontrado.');
    return usuario;
};

/**
 * Impede que o e-mail seja reaproveitado (comparacao case-insensitive).
 * @param {string} email
 * @param {number|null} [ignorarId]
 * @throws {ErroValidacao}
 */
const garantirEmailDisponivel = async (email, ignorarId = null) => {
    const emUso = await usuarioRepository.emailEmUso(email, ignorarId);
    if (emUso) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            email: 'Já existe um usuário cadastrado com este e-mail.',
        });
    }
};

/**
 * Protecoes contra o sistema ficar sem administrador.
 *
 * Dispara apenas quando o alvo E administrador ativo hoje e DEIXARIA de ser
 * (rebaixamento de perfil ou inativacao).
 *
 * @param {{id:number}} autor usuario autenticado que esta executando a acao
 * @param {{id:number, perfil:string, ativo:boolean, nome:string}} alvo estado atual
 * @param {{perfil:string, ativo:boolean}} novoEstado estado desejado
 * @throws {ErroValidacao}
 */
const garantirAdministracaoViavel = async (autor, alvo, novoEstado) => {
    const eraAdminAtivo = alvo.perfil === 'admin' && alvo.ativo === true;
    const continuaAdminAtivo = novoEstado.perfil === 'admin' && novoEstado.ativo === true;

    if (!eraAdminAtivo || continuaAdminAtivo) return;

    if (autor && Number(autor.id) === Number(alvo.id)) {
        const campos = {};
        if (novoEstado.perfil !== 'admin') {
            campos.perfil = 'Você não pode alterar o seu próprio perfil de administrador.';
        }
        if (novoEstado.ativo !== true) {
            campos.ativo = 'Você não pode inativar o seu próprio usuário.';
        }
        throw new ErroValidacao(
            'Você não pode rebaixar nem inativar o seu próprio usuário administrador.',
            campos
        );
    }

    const outros = await usuarioRepository.contarAdminsAtivos(alvo.id);
    if (outros === 0) {
        throw new ErroValidacao(
            'Este é o último administrador ativo do sistema: cadastre ou ative outro administrador antes de alterá-lo.',
            {
                perfil: 'É necessário manter ao menos um administrador ativo.',
                ativo: 'É necessário manter ao menos um administrador ativo.',
            }
        );
    }
};

/**
 * Cria um usuario com senha em hash e os vinculos de escopo, em transacao.
 * @param {object} _autor usuario autenticado (nao influencia as regras de criacao)
 * @param {object} dados dados validados por `validators/usuario`
 * @returns {Promise<object>} usuario criado (sem hash de senha)
 */
const criar = async (_autor, dados) => {
    await garantirEmailDisponivel(dados.email, null);

    const senhaHash = await autenticacaoService.gerarHash(dados.senha);

    try {
        return await db.transacao(async (cliente) => {
            // Campo a campo: nada do corpo da requisicao chega direto ao banco.
            const usuario = await usuarioRepository.inserir(
                {
                    nome: dados.nome,
                    email: dados.email,
                    senhaHash,
                    perfil: dados.perfil,
                    ativo: dados.ativo,
                },
                cliente
            );

            await usuarioRepository.substituirCursos(usuario.id, dados.cursosIds, cliente);
            await usuarioRepository.substituirCampus(usuario.id, dados.campusIds, cliente);

            return usuario;
        });
    } catch (erro) {
        return traduzirErroDoBanco(erro);
    }
};

/**
 * Atualiza um usuario. Senha nula/ausente mantem o hash atual.
 * @param {object} autor usuario autenticado
 * @param {number} id
 * @param {object} dados dados validados
 * @returns {Promise<object>} usuario atualizado
 */
const atualizar = async (autor, id, dados) => {
    const alvo = await obter(id);

    await garantirAdministracaoViavel(autor, alvo, {
        perfil: dados.perfil,
        ativo: dados.ativo,
    });
    await garantirEmailDisponivel(dados.email, alvo.id);

    const senhaHash = dados.senha ? await autenticacaoService.gerarHash(dados.senha) : null;

    try {
        return await db.transacao(async (cliente) => {
            const usuario = await usuarioRepository.atualizar(
                alvo.id,
                {
                    nome: dados.nome,
                    email: dados.email,
                    perfil: dados.perfil,
                    ativo: dados.ativo,
                    senhaHash,
                },
                cliente
            );

            if (!usuario) throw new ErroNaoEncontrado('Usuário não encontrado.');

            await usuarioRepository.substituirCursos(usuario.id, dados.cursosIds, cliente);
            await usuarioRepository.substituirCampus(usuario.id, dados.campusIds, cliente);

            return usuario;
        });
    } catch (erro) {
        return traduzirErroDoBanco(erro);
    }
};

/**
 * Redefine a senha de um usuario (a nova senha e informada pelo administrador).
 * @param {object} _autor usuario autenticado
 * @param {number} id
 * @param {string} senha senha em texto puro, ja validada (>= 8 caracteres)
 * @returns {Promise<object>} usuario alvo
 */
const redefinirSenha = async (_autor, id, senha) => {
    const alvo = await obter(id);
    const senhaHash = await autenticacaoService.gerarHash(senha);

    const atualizado = await usuarioRepository.atualizarSenhaHash(alvo.id, senhaHash);
    if (!atualizado) throw new ErroNaoEncontrado('Usuário não encontrado.');

    return alvo;
};

/**
 * Ativa ou inativa um usuario, respeitando as protecoes de administrador.
 * @param {object} autor
 * @param {number} id
 * @param {boolean} ativo
 * @returns {Promise<object>} usuario atualizado
 */
const definirAtivo = async (autor, id, ativo) => {
    const alvo = await obter(id);

    await garantirAdministracaoViavel(autor, alvo, {
        perfil: alvo.perfil,
        ativo: Boolean(ativo),
    });

    const usuario = await usuarioRepository.definirAtivo(alvo.id, ativo);
    if (!usuario) throw new ErroNaoEncontrado('Usuário não encontrado.');
    return usuario;
};

/**
 * Exclui um usuario definitivamente.
 *
 * Permitido apenas quando o alvo nao e o proprio autor e nao e o ultimo
 * administrador ativo. A acao preferencial continua sendo inativar.
 * @param {object} autor
 * @param {number} id
 * @returns {Promise<object>} usuario removido
 */
const excluir = async (autor, id) => {
    const alvo = await obter(id);

    if (autor && Number(autor.id) === Number(alvo.id)) {
        throw new ErroPermissao('Você não pode excluir o seu próprio usuário.');
    }

    if (alvo.perfil === 'admin' && alvo.ativo) {
        const outros = await usuarioRepository.contarAdminsAtivos(alvo.id);
        if (outros === 0) {
            throw new ErroValidacao(
                'Este é o último administrador ativo do sistema e não pode ser excluído.',
                { geral: 'É necessário manter ao menos um administrador ativo.' }
            );
        }
    }

    try {
        // usuario_cursos e usuario_campus saem junto (ON DELETE CASCADE).
        const removido = await usuarioRepository.excluir(alvo.id);
        if (!removido) throw new ErroNaoEncontrado('Usuário não encontrado.');
    } catch (erro) {
        if (erro && erro.code === CODIGO_FK) {
            throw new ErroDependencia(
                `O usuário "${alvo.nome}" possui registros vinculados e não pode ser excluído. Inative o usuário para preservar o histórico.`
            );
        }
        throw erro;
    }

    return alvo;
};

/**
 * Cursos e campus disponiveis para vincular. Traz os ativos e tambem os que ja
 * estao vinculados ao usuario (mesmo inativos), para nao perder o vinculo.
 * @param {{cursosIds?:number[], campusIds?:number[]}} [vinculos]
 * @returns {Promise<{cursos:object[], campus:object[]}>}
 */
const opcoesFormulario = async (vinculos = {}) => {
    const [cursos, campus] = await Promise.all([
        usuarioRepository.listarCursosParaEscopo(vinculos.cursosIds || []),
        usuarioRepository.listarCampusParaEscopo(vinculos.campusIds || []),
    ]);

    return { cursos, campus };
};

module.exports = {
    listar,
    obter,
    criar,
    atualizar,
    redefinirSenha,
    definirAtivo,
    excluir,
    opcoesFormulario,
};
