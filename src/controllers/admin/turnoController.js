/**
 * Controller de turnos.
 *
 * A listagem mostra quantos horarios cada turno possui (valor sempre vindo do
 * banco, nunca fixo no codigo) e leva ao CRUD de horarios daquele turno.
 */
const turnoService = require('../../services/turnoService');
const { validarTurno, validarFiltros, gerarSlug } = require('../../validators/turno');
const { lerParametros, queryString } = require('../../utils/paginacao');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    async: assincrono,
} = require('../../utils/erros');

const MENU = 'turnos';
const BASE = '/admin/turnos';

const ehErroDeFormulario = (erro) =>
    erro instanceof ErroValidacao ||
    erro instanceof ErroConflito ||
    erro instanceof ErroDependencia;

const texto = (valor) => (typeof valor === 'string' ? valor : '');

/**
 * Valores do formulario reconstruidos a partir do que o usuario digitou.
 * @param {Record<string, unknown>} corpo
 */
const valoresDoCorpo = (corpo = {}) => ({
    nome: texto(corpo.nome),
    slug: texto(corpo.slug),
    icone: texto(corpo.icone),
    tema_class: texto(corpo.tema_class),
    ordem: texto(corpo.ordem),
    ativo: String(corpo.ativo === undefined ? '1' : corpo.ativo) !== '0',
});

/**
 * @param {object} turno
 */
const valoresDoRegistro = (turno) => ({
    nome: turno.nome || '',
    slug: turno.slug || '',
    icone: turno.icone || '',
    tema_class: turno.tema_class || '',
    ordem: turno.ordem === null || turno.ordem === undefined ? '' : String(turno.ordem),
    ativo: turno.ativo !== false,
});

/**
 * Renderiza o formulario de criacao/edicao.
 */
const renderizarFormulario = (
    req,
    res,
    { status = 200, registro = null, valores, erros = {}, mensagemErro = null }
) => {
    const edicao = Boolean(registro);

    res.status(status).render('admin/turnos/formulario', {
        tituloPagina: edicao ? 'Editar turno' : 'Novo turno',
        subtitulo: edicao ? registro.nome : 'Cadastro de turno da grade',
        menuAtivo: MENU,
        breadcrumbs: [
            { texto: 'Painel', url: '/admin' },
            { texto: 'Turnos', url: BASE },
            { texto: edicao ? 'Editar' : 'Novo' },
        ],
        acao: req.withBase(edicao ? `${BASE}/${registro.id}` : BASE),
        voltarUrl: req.withBase(BASE),
        edicao,
        registro,
        valores,
        // Sugestao exibida quando o identificador esta em branco.
        slugSugerido: gerarSlug(valores.nome),
        erros,
        mensagemErro,
    });
};

/**
 * GET /admin/turnos
 * @type {import('express').RequestHandler}
 */
const lista = assincrono(async (req, res) => {
    const filtros = validarFiltros(req.query);
    const { pagina, porPagina } = lerParametros(req.query);

    const { itens, paginacao } = await turnoService.listar({
        busca: filtros.busca,
        ativo: filtros.ativo,
        pagina,
        porPagina,
    });

    res.render('admin/turnos/lista', {
        tituloPagina: 'Turnos',
        subtitulo: 'Turnos e quantidade de horários de cada um',
        menuAtivo: MENU,
        breadcrumbs: [{ texto: 'Painel', url: '/admin' }, { texto: 'Turnos' }],
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
 * GET /admin/turnos/novo
 * @type {import('express').RequestHandler}
 */
const novo = (req, res) => {
    renderizarFormulario(req, res, {
        valores: {
            nome: '',
            slug: '',
            icone: 'fa-clock',
            tema_class: '',
            ordem: '',
            ativo: true,
        },
    });
};

/**
 * POST /admin/turnos
 * @type {import('express').RequestHandler}
 */
const criar = assincrono(async (req, res) => {
    try {
        const dados = validarTurno(req.body);
        const turno = await turnoService.criar(dados);
        req.flash('sucesso', `Turno "${turno.nome}" cadastrado com sucesso.`);
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
 * GET /admin/turnos/:id/editar
 * @type {import('express').RequestHandler}
 */
const editar = assincrono(async (req, res) => {
    const turno = await turnoService.obter(req.params.id);
    renderizarFormulario(req, res, { registro: turno, valores: valoresDoRegistro(turno) });
});

/**
 * POST /admin/turnos/:id
 * @type {import('express').RequestHandler}
 */
const atualizar = assincrono(async (req, res) => {
    const turno = await turnoService.obter(req.params.id);

    try {
        const dados = validarTurno(req.body);
        const atualizado = await turnoService.atualizar(turno.id, dados);
        req.flash('sucesso', `Turno "${atualizado.nome}" atualizado.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarFormulario(req, res, {
            status: erro.status,
            registro: turno,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            mensagemErro: erro.message,
        });
    }
});

/**
 * POST /admin/turnos/:id/situacao
 * @type {import('express').RequestHandler}
 */
const alterarSituacao = assincrono(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';

    try {
        const turno = await turnoService.definirAtivo(req.params.id, ativar);
        req.flash('sucesso', `Turno "${turno.nome}" ${ativar ? 'reativado' : 'inativado'}.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(req.withBase(BASE));
});

/**
 * POST /admin/turnos/:id/excluir
 * @type {import('express').RequestHandler}
 */
const excluir = assincrono(async (req, res) => {
    try {
        const turno = await turnoService.excluir(req.params.id);
        req.flash('sucesso', `Turno "${turno.nome}" excluído.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(req.withBase(BASE));
});

module.exports = { lista, novo, criar, editar, atualizar, alterarSituacao, excluir };
