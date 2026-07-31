/**
 * Controller de campus: le a requisicao, delega ao servico e renderiza.
 *
 * Sem SQL e sem regra de negocio. Os unicos `try/catch` existentes convertem
 * erros de dominio ja tratados (validacao, conflito, dependencia) em uma nova
 * exibicao do formulario ou em mensagem flash — qualquer outro erro sobe para o
 * tratador global.
 */
const campusService = require('../../services/campusService');
const { validarCampus, validarFiltros } = require('../../validators/campus');
const { lerParametros, queryString } = require('../../utils/paginacao');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    async: assincrono,
} = require('../../utils/erros');

const MENU = 'campus';
const BASE = '/admin/campus';

/** Erros de dominio que o formulario sabe exibir sem sair da tela. */
const ehErroDeFormulario = (erro) =>
    erro instanceof ErroValidacao ||
    erro instanceof ErroConflito ||
    erro instanceof ErroDependencia;

/**
 * Valores do formulario reconstruidos a partir do que o usuario digitou.
 * @param {Record<string, unknown>} corpo
 * @returns {{nome:string, sigla:string, ativo:boolean}}
 */
const valoresDoCorpo = (corpo = {}) => ({
    nome: typeof corpo.nome === 'string' ? corpo.nome : '',
    sigla: typeof corpo.sigla === 'string' ? corpo.sigla : '',
    ativo: String(corpo.ativo === undefined ? '1' : corpo.ativo) !== '0',
});

/**
 * Valores do formulario a partir de um registro existente.
 * @param {object} campus
 */
const valoresDoRegistro = (campus) => ({
    nome: campus.nome || '',
    sigla: campus.sigla || '',
    ativo: campus.ativo !== false,
});

/**
 * Renderiza o formulario de criacao/edicao.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{status?:number, registro?:object|null, valores:object,
 *          erros?:Record<string,string>, mensagemErro?:string|null}} opcoes
 */
const renderizarFormulario = (
    req,
    res,
    { status = 200, registro = null, valores, erros = {}, mensagemErro = null }
) => {
    const edicao = Boolean(registro);

    res.status(status).render('admin/campus/formulario', {
        tituloPagina: edicao ? 'Editar campus' : 'Novo campus',
        subtitulo: edicao ? registro.nome : 'Cadastro de unidade da instituição',
        menuAtivo: MENU,
        breadcrumbs: [
            { texto: 'Painel', url: '/admin' },
            { texto: 'Campus', url: BASE },
            { texto: edicao ? 'Editar' : 'Novo' },
        ],
        acao: req.withBase(edicao ? `${BASE}/${registro.id}` : BASE),
        voltarUrl: req.withBase(BASE),
        edicao,
        registro,
        valores,
        erros,
        mensagemErro,
    });
};

/**
 * GET /admin/campus
 * @type {import('express').RequestHandler}
 */
const lista = assincrono(async (req, res) => {
    const filtros = validarFiltros(req.query);
    const { pagina, porPagina } = lerParametros(req.query);

    const { itens, paginacao } = await campusService.listar({
        busca: filtros.busca,
        ativo: filtros.ativo,
        pagina,
        porPagina,
    });

    res.render('admin/campus/lista', {
        tituloPagina: 'Campus',
        subtitulo: 'Unidades da instituição',
        menuAtivo: MENU,
        breadcrumbs: [{ texto: 'Painel', url: '/admin' }, { texto: 'Campus' }],
        itens,
        paginacao,
        filtros: {
            busca: filtros.busca || '',
            ativo: filtros.ativo === null ? '' : String(filtros.ativo ? 1 : 0),
        },
        urlBase: (numero) => req.withBase(`${BASE}${queryString(req.query, { pagina: numero })}`),
    });
});

/**
 * GET /admin/campus/novo
 * @type {import('express').RequestHandler}
 */
const novo = (req, res) => {
    renderizarFormulario(req, res, { valores: { nome: '', sigla: '', ativo: true } });
};

/**
 * POST /admin/campus
 * @type {import('express').RequestHandler}
 */
const criar = assincrono(async (req, res) => {
    try {
        const dados = validarCampus(req.body);
        const campus = await campusService.criar(dados);
        req.flash('sucesso', `Campus "${campus.nome}" cadastrado com sucesso.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarFormulario(req, res, {
            status: erro.status,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            mensagemErro: erro.message,
        });
    }
});

/**
 * GET /admin/campus/:id/editar
 * @type {import('express').RequestHandler}
 */
const editar = assincrono(async (req, res) => {
    const campus = await campusService.obter(req.params.id);
    renderizarFormulario(req, res, { registro: campus, valores: valoresDoRegistro(campus) });
});

/**
 * POST /admin/campus/:id
 * @type {import('express').RequestHandler}
 */
const atualizar = assincrono(async (req, res) => {
    // Confirma a existencia antes de validar: id invalido e 404, nao 422.
    const campus = await campusService.obter(req.params.id);

    try {
        const dados = validarCampus(req.body);
        const atualizado = await campusService.atualizar(campus.id, dados);
        req.flash('sucesso', `Campus "${atualizado.nome}" atualizado.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarFormulario(req, res, {
            status: erro.status,
            registro: campus,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            mensagemErro: erro.message,
        });
    }
});

/**
 * POST /admin/campus/:id/situacao — ativa ou inativa.
 * @type {import('express').RequestHandler}
 */
const alterarSituacao = assincrono(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';

    try {
        const campus = await campusService.definirAtivo(req.params.id, ativar);
        req.flash('sucesso', `Campus "${campus.nome}" ${ativar ? 'reativado' : 'inativado'}.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(req.withBase(BASE));
});

/**
 * POST /admin/campus/:id/excluir — exclusao real, apenas sem vinculos.
 * @type {import('express').RequestHandler}
 */
const excluir = assincrono(async (req, res) => {
    try {
        const campus = await campusService.excluir(req.params.id);
        req.flash('sucesso', `Campus "${campus.nome}" excluído.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(req.withBase(BASE));
});

module.exports = { lista, novo, criar, editar, atualizar, alterarSituacao, excluir };
