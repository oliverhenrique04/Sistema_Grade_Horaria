/**
 * Controller dos horarios (periodos) de cada turno.
 *
 * A lista e ordenada e agrupada por turno e pode ser filtrada por turno e
 * situacao. Regras estruturais (50 minutos e sobreposicao) vem do banco e sao
 * traduzidas pelo servico em mensagens de campo — nunca em pagina de erro.
 */
const horarioTurnoService = require('../../services/horarioTurnoService');
const turnoService = require('../../services/turnoService');
const {
    validarHorario,
    validarFiltros,
    somarMinutos,
    DURACAO_MINUTOS,
} = require('../../validators/horarioTurno');
const { lerParametros, queryString } = require('../../utils/paginacao');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    async: assincrono,
} = require('../../utils/erros');

const MENU = 'horarios';
const BASE = '/admin/horarios';

const ehErroDeFormulario = (erro) =>
    erro instanceof ErroValidacao ||
    erro instanceof ErroConflito ||
    erro instanceof ErroDependencia;

const texto = (valor) => (typeof valor === 'string' ? valor : '');

/**
 * Corta "HH:MM:SS" em "HH:MM" para o `<input type="time">`.
 * @param {unknown} valor
 * @returns {string}
 */
const paraCampoHora = (valor) => {
    if (!valor) return '';
    return String(valor).slice(0, 5);
};

/**
 * @param {Record<string, unknown>} corpo
 */
const valoresDoCorpo = (corpo = {}) => ({
    turno_id: texto(corpo.turno_id),
    nome: texto(corpo.nome),
    ordem: texto(corpo.ordem),
    hora_inicio: paraCampoHora(corpo.hora_inicio),
    hora_fim: paraCampoHora(corpo.hora_fim),
    ativo: String(corpo.ativo === undefined ? '1' : corpo.ativo) !== '0',
});

/**
 * @param {object} horario
 */
const valoresDoRegistro = (horario) => ({
    turno_id: String(horario.turno_id),
    nome: horario.nome || '',
    ordem: horario.ordem === null || horario.ordem === undefined ? '' : String(horario.ordem),
    hora_inicio: paraCampoHora(horario.hora_inicio),
    hora_fim: paraCampoHora(horario.hora_fim),
    ativo: horario.ativo !== false,
});

/**
 * Renderiza o formulario de criacao/edicao.
 */
const renderizarFormulario = async (
    req,
    res,
    { status = 200, registro = null, valores, erros = {}, mensagemErro = null }
) => {
    const edicao = Boolean(registro);

    // Turnos inativos continuam listados quando ja vinculados ao registro.
    const turnos = await turnoService.listarParaSelecao({
        apenasAtivos: true,
        incluirId: registro ? registro.turno_id : null,
    });

    const emUso = edicao ? await horarioTurnoService.emUso(registro.id) : false;

    res.status(status).render('admin/horarios/formulario', {
        tituloPagina: edicao ? 'Editar horário' : 'Novo horário',
        subtitulo: edicao ? registro.nome : `Período de ${DURACAO_MINUTOS} minutos`,
        menuAtivo: MENU,
        breadcrumbs: [
            { texto: 'Painel', url: '/admin' },
            { texto: 'Horários dos turnos', url: BASE },
            { texto: edicao ? 'Editar' : 'Novo' },
        ],
        acao: req.withBase(edicao ? `${BASE}/${registro.id}` : BASE),
        voltarUrl: req.withBase(`${BASE}${queryString({ turno_id: valores.turno_id })}`),
        edicao,
        registro,
        turnos,
        emUso,
        valores,
        erros,
        mensagemErro,
        duracaoMinutos: DURACAO_MINUTOS,
        // Sugestao exibida ao lado do campo (o JS do formulario faz o mesmo calculo).
        horaFimSugerida: somarMinutos(valores.hora_inicio, DURACAO_MINUTOS),
        scriptsExtras: ['/js/horarios.js'],
    });
};

/**
 * GET /admin/horarios
 * @type {import('express').RequestHandler}
 */
const lista = assincrono(async (req, res) => {
    const filtros = validarFiltros(req.query);
    const { pagina, porPagina } = lerParametros(req.query);

    const [{ itens, paginacao }, turnos] = await Promise.all([
        horarioTurnoService.listar({
            turnoId: filtros.turno_id,
            ativo: filtros.ativo,
            busca: filtros.busca,
            pagina,
            porPagina,
        }),
        turnoService.listarParaSelecao({ apenasAtivos: false }),
    ]);

    res.render('admin/horarios/lista', {
        tituloPagina: 'Horários dos turnos',
        subtitulo: `Cada período dura ${DURACAO_MINUTOS} minutos; intervalos entre períodos são permitidos`,
        menuAtivo: MENU,
        breadcrumbs: [{ texto: 'Painel', url: '/admin' }, { texto: 'Horários dos turnos' }],
        itens,
        paginacao,
        turnos,
        duracaoMinutos: DURACAO_MINUTOS,
        filtros: {
            turno_id: filtros.turno_id === null ? '' : String(filtros.turno_id),
            busca: filtros.busca || '',
            ativo: filtros.ativo === null ? '' : String(filtros.ativo ? 1 : 0),
        },
        urlBase: (numero) => req.withBase(`${BASE}${queryString(req.query, { pagina: numero })}`),
    });
});

/**
 * GET /admin/horarios/novo
 * @type {import('express').RequestHandler}
 */
const novo = assincrono(async (req, res) => {
    // Pre-seleciona o turno quando o usuario chega pela lista ja filtrada e
    // sugere a proxima ordem livre daquele turno.
    const turnoId = texto(req.query.turno_id);
    const proxima = turnoId ? await horarioTurnoService.proximaOrdem(turnoId) : null;

    await renderizarFormulario(req, res, {
        valores: {
            turno_id: turnoId,
            nome: proxima ? `${proxima}º horário` : '',
            ordem: proxima ? String(proxima) : '',
            hora_inicio: '',
            hora_fim: '',
            ativo: true,
        },
    });
});

/**
 * POST /admin/horarios
 * @type {import('express').RequestHandler}
 */
const criar = assincrono(async (req, res) => {
    try {
        const dados = validarHorario(req.body);
        const horario = await horarioTurnoService.criar(dados);
        req.flash('sucesso', `Horário "${horario.nome}" cadastrado com sucesso.`);
        return res.redirect(req.withBase(`${BASE}${queryString({ turno_id: dados.turno_id })}`));
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
 * GET /admin/horarios/:id/editar
 * @type {import('express').RequestHandler}
 */
const editar = assincrono(async (req, res) => {
    const horario = await horarioTurnoService.obter(req.params.id);
    await renderizarFormulario(req, res, {
        registro: horario,
        valores: valoresDoRegistro(horario),
    });
});

/**
 * POST /admin/horarios/:id
 * @type {import('express').RequestHandler}
 */
const atualizar = assincrono(async (req, res) => {
    const horario = await horarioTurnoService.obter(req.params.id);

    try {
        const dados = validarHorario(req.body);
        const atualizado = await horarioTurnoService.atualizar(horario.id, dados);
        req.flash('sucesso', `Horário "${atualizado.nome}" atualizado.`);
        return res.redirect(req.withBase(`${BASE}${queryString({ turno_id: dados.turno_id })}`));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarFormulario(req, res, {
            status: erro.status,
            registro: horario,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            mensagemErro: erro.message,
        });
    }
});

/**
 * POST /admin/horarios/:id/situacao
 * @type {import('express').RequestHandler}
 */
const alterarSituacao = assincrono(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';
    const retorno = req.withBase(`${BASE}${queryString({ turno_id: req.body.turno_id })}`);

    try {
        const horario = await horarioTurnoService.definirAtivo(req.params.id, ativar);
        req.flash('sucesso', `Horário "${horario.nome}" ${ativar ? 'reativado' : 'inativado'}.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(retorno);
});

/**
 * POST /admin/horarios/:id/excluir
 * @type {import('express').RequestHandler}
 */
const excluir = assincrono(async (req, res) => {
    const retorno = req.withBase(`${BASE}${queryString({ turno_id: req.body.turno_id })}`);

    try {
        const horario = await horarioTurnoService.excluir(req.params.id);
        req.flash('sucesso', `Horário "${horario.nome}" excluído.`);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        req.flash('erro', erro.message);
    }

    res.redirect(retorno);
});

module.exports = { lista, novo, criar, editar, atualizar, alterarSituacao, excluir };
