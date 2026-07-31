/**
 * Controller do CRUD de usuarios (`/admin/usuarios`).
 *
 * Restrito ao perfil `admin` (garantido nas rotas, nao aqui).
 *
 * Regras de exibicao ligadas a seguranca:
 *  - a senha NUNCA volta para a view: o campo aparece sempre vazio, mesmo depois
 *    de um erro de validacao;
 *  - o hash tambem nunca sai do servico;
 *  - nenhum log registra o corpo da requisicao.
 */
const usuarioService = require('../../services/usuarioService');
const paginacaoUtil = require('../../utils/paginacao');
const { ErroValidacao, ErroDependencia } = require('../../utils/erros');
const {
    schemaCriacao,
    schemaEdicao,
    schemaSenha,
    schemaStatus,
    schemaFiltros,
    validar,
    PERFIS,
    SENHA_MINIMA,
} = require('../../validators/usuario');

const CAMINHO_LISTA = '/admin/usuarios';

const trilha = (...itens) => [{ texto: 'Painel', url: '/admin' }, ...itens];

/** Normaliza uma lista de ids vinda do corpo (checkboxes) para numeros. */
const idsDoCorpo = (valor) => {
    if (valor === undefined || valor === null || valor === '') return [];
    const lista = Array.isArray(valor) ? valor : [valor];
    return lista
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0);
};

/**
 * Valores reexibidos no formulario apos erro. A senha e deliberadamente omitida.
 * Somente campos conhecidos sao lidos do corpo (nunca `{...req.body}`).
 * @param {object} corpo `req.body`
 * @param {object} [base] usuario atual (edicao)
 * @returns {object}
 */
const valoresDoCorpo = (corpo = {}, base = {}) => ({
    id: base.id || null,
    nome: corpo.nome !== undefined ? corpo.nome : base.nome || '',
    email: corpo.email !== undefined ? corpo.email : base.email || '',
    perfil: corpo.perfil !== undefined ? corpo.perfil : base.perfil || 'coordenador',
    ativo: corpo.ativo !== undefined ? String(corpo.ativo) !== 'false' : base.ativo !== false,
    cursosIds: corpo.cursosIds !== undefined ? idsDoCorpo(corpo.cursosIds) : base.cursosIds || [],
    campusIds: corpo.campusIds !== undefined ? idsDoCorpo(corpo.campusIds) : base.campusIds || [],
});

/**
 * Renderiza o formulario (novo ou edicao).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{modo:'criar'|'editar', valores:object, erros?:object, status?:number,
 *          usuario?:object}} opcoes
 */
const renderizarFormulario = async (req, res, opcoes) => {
    const { modo, valores, erros = {}, status = 200, usuario = null, mensagem = '' } = opcoes;
    const edicao = modo === 'editar';

    const listas = await usuarioService.opcoesFormulario({
        cursosIds: valores.cursosIds,
        campusIds: valores.campusIds,
    });

    res.status(status).render('admin/usuarios/formulario', {
        tituloPagina: edicao ? 'Editar usuário' : 'Novo usuário',
        subtitulo: edicao ? valores.nome : 'Cadastro de usuário',
        menuAtivo: 'usuarios',
        breadcrumbs: trilha(
            { texto: 'Usuários', url: CAMINHO_LISTA },
            { texto: edicao ? 'Editar' : 'Novo' }
        ),
        modo,
        usuario,
        valores,
        erros,
        mensagem,
        perfis: PERFIS,
        opcoes: listas,
        senhaMinima: SENHA_MINIMA,
        acao: edicao ? `${CAMINHO_LISTA}/${valores.id}` : CAMINHO_LISTA,
        ehProprioUsuario: Boolean(valores.id) && Number(valores.id) === Number(req.usuario.id),
    });
};

/** GET /admin/usuarios */
const lista = async (req, res) => {
    const filtros = validar(schemaFiltros, req.query, 'Filtros inválidos.');
    const { pagina, porPagina } = paginacaoUtil.lerParametros(req.query);

    const { itens, paginacao } = await usuarioService.listar({ ...filtros, pagina, porPagina });

    res.render('admin/usuarios/lista', {
        tituloPagina: 'Usuários',
        subtitulo: 'Contas de acesso ao painel',
        menuAtivo: 'usuarios',
        breadcrumbs: trilha({ texto: 'Usuários' }),
        usuarios: itens,
        paginacao,
        filtros,
        perfis: PERFIS,
        urlBase: (numero) =>
            res.locals.withBase(
                `${CAMINHO_LISTA}${paginacaoUtil.queryString(req.query, { pagina: numero })}`
            ),
    });
};

/** GET /admin/usuarios/novo */
const formularioNovo = async (req, res) => {
    await renderizarFormulario(req, res, {
        modo: 'criar',
        valores: {
            id: null,
            nome: '',
            email: '',
            perfil: 'coordenador',
            ativo: true,
            cursosIds: [],
            campusIds: [],
        },
    });
};

/** POST /admin/usuarios */
const criar = async (req, res) => {
    try {
        const dados = validar(schemaCriacao, req.body);
        const usuario = await usuarioService.criar(req.usuario, dados);

        req.flash('sucesso', `Usuário "${usuario.nome}" cadastrado com sucesso.`);
        return res.redirect(res.locals.withBase(CAMINHO_LISTA));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;

        return renderizarFormulario(req, res, {
            modo: 'criar',
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            status: erro.status || 422,
        });
    }
};

/** GET /admin/usuarios/:id/editar */
const formularioEdicao = async (req, res) => {
    const usuario = await usuarioService.obter(req.params.id);

    await renderizarFormulario(req, res, {
        modo: 'editar',
        usuario,
        valores: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            perfil: usuario.perfil,
            ativo: usuario.ativo,
            cursosIds: usuario.cursosIds,
            campusIds: usuario.campusIds,
        },
    });
};

/** POST /admin/usuarios/:id */
const atualizar = async (req, res) => {
    const atual = await usuarioService.obter(req.params.id);

    try {
        const dados = validar(schemaEdicao, req.body);
        const usuario = await usuarioService.atualizar(req.usuario, atual.id, dados);

        req.flash('sucesso', `Usuário "${usuario.nome}" atualizado com sucesso.`);
        return res.redirect(res.locals.withBase(CAMINHO_LISTA));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;

        return renderizarFormulario(req, res, {
            modo: 'editar',
            usuario: atual,
            valores: valoresDoCorpo(req.body, atual),
            erros: erro.campos || {},
            status: erro.status || 422,
            mensagem: erro.message,
        });
    }
};

/** POST /admin/usuarios/:id/senha */
const redefinirSenha = async (req, res) => {
    const atual = await usuarioService.obter(req.params.id);

    try {
        const dados = validar(schemaSenha, req.body, 'Verifique a nova senha.');
        await usuarioService.redefinirSenha(req.usuario, atual.id, dados.senha);

        req.flash('sucesso', `Senha de "${atual.nome}" redefinida com sucesso.`);
        return res.redirect(res.locals.withBase(`${CAMINHO_LISTA}/${atual.id}/editar`));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;

        return renderizarFormulario(req, res, {
            modo: 'editar',
            usuario: atual,
            valores: {
                id: atual.id,
                nome: atual.nome,
                email: atual.email,
                perfil: atual.perfil,
                ativo: atual.ativo,
                cursosIds: atual.cursosIds,
                campusIds: atual.campusIds,
            },
            erros: erro.campos || {},
            status: erro.status || 422,
        });
    }
};

/** POST /admin/usuarios/:id/status */
const alterarStatus = async (req, res) => {
    const { ativo } = validar(schemaStatus, req.body, 'Situação inválida.');

    try {
        const usuario = await usuarioService.definirAtivo(req.usuario, req.params.id, ativo);
        req.flash(
            'sucesso',
            `Usuário "${usuario.nome}" ${ativo ? 'reativado' : 'inativado'} com sucesso.`
        );
    } catch (erro) {
        // Protecoes de administrador nao tem formulario para reexibir: viram aviso.
        if (!(erro instanceof ErroValidacao)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(res.locals.withBase(CAMINHO_LISTA));
};

/** POST /admin/usuarios/:id/excluir */
const excluir = async (req, res) => {
    try {
        const usuario = await usuarioService.excluir(req.usuario, req.params.id);
        req.flash('sucesso', `Usuário "${usuario.nome}" excluído.`);
    } catch (erro) {
        const conhecido = erro instanceof ErroValidacao || erro instanceof ErroDependencia;
        if (!conhecido) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(res.locals.withBase(CAMINHO_LISTA));
};

module.exports = {
    lista,
    formularioNovo,
    criar,
    formularioEdicao,
    atualizar,
    redefinirSenha,
    alterarStatus,
    excluir,
};
