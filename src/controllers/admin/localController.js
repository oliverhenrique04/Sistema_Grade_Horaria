/**
 * Controller de locais (salas, laboratorios, auditorios...).
 *
 * O escopo por campus e aplicado no servico: o perfil `nap` so lista e so
 * mantem locais dos campus vinculados a ele. A verificacao acontece no backend,
 * independentemente do que a interface exibe.
 */
const localService = require('../../services/localService');
const { validarLocal, validarFiltros } = require('../../validators/local');
const { lerParametros, queryString } = require('../../utils/paginacao');
const { TIPOS_LOCAL } = require('../../utils/formatadores');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    async: assincrono,
} = require('../../utils/erros');

const MENU = 'locais';
const BASE = '/admin/locais';

const ehErroDeFormulario = (erro) =>
    erro instanceof ErroValidacao ||
    erro instanceof ErroConflito ||
    erro instanceof ErroDependencia;

const texto = (valor) => (typeof valor === 'string' ? valor : '');

/**
 * @param {Record<string, unknown>} corpo
 */
const valoresDoCorpo = (corpo = {}) => ({
    campus_id: texto(corpo.campus_id),
    nome: texto(corpo.nome),
    codigo: texto(corpo.codigo),
    tipo: texto(corpo.tipo) || 'sala',
    capacidade: texto(corpo.capacidade),
    ativo: String(corpo.ativo === undefined ? '1' : corpo.ativo) !== '0',
});

/**
 * @param {object} local
 */
const valoresDoRegistro = (local) => ({
    campus_id: String(local.campus_id),
    nome: local.nome || '',
    codigo: local.codigo || '',
    tipo: local.tipo || 'sala',
    capacidade:
        local.capacidade === null || local.capacidade === undefined ? '' : String(local.capacidade),
    ativo: local.ativo !== false,
});

/**
 * Renderiza o formulario de criacao/edicao com apenas os campus do escopo.
 */
const renderizarFormulario = async (
    req,
    res,
    { status = 200, registro = null, valores, erros = {}, mensagemErro = null }
) => {
    const edicao = Boolean(registro);

    const campus = await localService.campusDisponiveis(
        req.usuario,
        registro ? registro.campus_id : null
    );

    res.status(status).render('admin/locais/formulario', {
        tituloPagina: edicao ? 'Editar local' : 'Novo local',
        subtitulo: edicao ? registro.nome : 'Cadastro de sala, laboratório ou ambiente',
        menuAtivo: MENU,
        breadcrumbs: [
            { texto: 'Painel', url: '/admin' },
            { texto: 'Locais', url: BASE },
            { texto: edicao ? 'Editar' : 'Novo' },
        ],
        acao: req.withBase(edicao ? `${BASE}/${registro.id}` : BASE),
        voltarUrl: req.withBase(BASE),
        edicao,
        registro,
        campus,
        tipos: TIPOS_LOCAL,
        valores,
        erros,
        mensagemErro,
    });
};

/**
 * GET /admin/locais
 * @type {import('express').RequestHandler}
 */
const lista = assincrono(async (req, res) => {
    const filtros = validarFiltros(req.query);
    const { pagina, porPagina } = lerParametros(req.query);

    const [{ itens, paginacao }, campus] = await Promise.all([
        localService.listar(
            {
                campusId: filtros.campus_id,
                tipo: filtros.tipo,
                busca: filtros.busca,
                ativo: filtros.ativo,
                pagina,
                porPagina,
            },
            req.usuario
        ),
        localService.campusDisponiveis(req.usuario),
    ]);

    res.render('admin/locais/lista', {
        tituloPagina: 'Locais',
        subtitulo: 'Salas, laboratórios e demais ambientes por campus',
        menuAtivo: MENU,
        breadcrumbs: [{ texto: 'Painel', url: '/admin' }, { texto: 'Locais' }],
        itens,
        paginacao,
        campus,
        tipos: TIPOS_LOCAL,
        filtros: {
            campus_id: filtros.campus_id === null ? '' : String(filtros.campus_id),
            tipo: filtros.tipo || '',
            busca: filtros.busca || '',
            ativo: filtros.ativo === null ? '' : String(filtros.ativo ? 1 : 0),
        },
        urlBase: (numero) => req.withBase(`${BASE}${queryString(req.query, { pagina: numero })}`),
    });
});

/**
 * GET /admin/locais/novo
 * @type {import('express').RequestHandler}
 */
const novo = assincrono(async (req, res) => {
    await renderizarFormulario(req, res, {
        valores: {
            campus_id: texto(req.query.campus_id),
            nome: '',
            codigo: '',
            tipo: 'sala',
            capacidade: '',
            ativo: true,
        },
    });
});

/**
 * POST /admin/locais
 * @type {import('express').RequestHandler}
 */
const criar = assincrono(async (req, res) => {
    try {
        const dados = validarLocal(req.body);
        const local = await localService.criar(dados, req.usuario);
        req.flash('sucesso', `Local "${local.nome}" cadastrado com sucesso.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        // ErroPermissao (campus fora do escopo) sobe para o tratador global: 403.
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
 * GET /admin/locais/:id/editar
 * @type {import('express').RequestHandler}
 */
const editar = assincrono(async (req, res) => {
    const local = await localService.obter(req.params.id, req.usuario);
    await renderizarFormulario(req, res, {
        registro: local,
        valores: valoresDoRegistro(local),
    });
});

/**
 * POST /admin/locais/:id
 * @type {import('express').RequestHandler}
 */
const atualizar = assincrono(async (req, res) => {
    const local = await localService.obter(req.params.id, req.usuario);

    try {
        const dados = validarLocal(req.body);
        const atualizado = await localService.atualizar(local.id, dados, req.usuario);
        req.flash('sucesso', `Local "${atualizado.nome}" atualizado.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarFormulario(req, res, {
            status: erro.status,
            registro: local,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            mensagemErro: erro.message,
        });
    }
});

/**
 * POST /admin/locais/:id/situacao
 * @type {import('express').RequestHandler}
 */
const alterarSituacao = assincrono(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';

    try {
        const local = await localService.definirAtivo(req.params.id, ativar, req.usuario);
        req.flash('sucesso', `Local "${local.nome}" ${ativar ? 'reativado' : 'inativado'}.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(req.withBase(BASE));
});

/**
 * POST /admin/locais/:id/excluir
 * @type {import('express').RequestHandler}
 */
const excluir = assincrono(async (req, res) => {
    try {
        const local = await localService.excluir(req.params.id, req.usuario);
        req.flash('sucesso', `Local "${local.nome}" excluído.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(req.withBase(BASE));
});

module.exports = { lista, novo, criar, editar, atualizar, alterarSituacao, excluir };
