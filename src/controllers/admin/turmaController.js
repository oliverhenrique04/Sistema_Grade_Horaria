/**
 * Controller do CRUD de turmas (`/admin/turmas`).
 *
 * Fluxo padrao: POST-Redirect-GET. Erros de validacao reexibem o formulario com
 * o que foi digitado e a mensagem de cada campo (status 422); sucesso redireciona
 * com mensagem em `req.flash`.
 *
 * O objeto persistido e montado campo a campo pelo validador e pelo servico:
 * nenhum spread de `req.body` chega ao banco (protecao contra mass assignment).
 */
const turmaService = require('../../services/turmaService');
const paginacaoUtil = require('../../utils/paginacao');
const { ErroValidacao, ErroDependencia, ErroAplicacao } = require('../../utils/erros');
const {
    schemaTurma,
    schemaStatus,
    schemaFiltros,
    validar,
    SEMESTRES,
} = require('../../validators/turma');

const CAMINHO_LISTA = '/admin/turmas';

const trilha = (...itens) => [{ texto: 'Painel', url: '/admin' }, ...itens];

/**
 * Reescreve os valores digitados para reexibir o formulario apos um erro.
 * Somente campos conhecidos sao lidos do corpo (nunca `{...req.body}`).
 * @param {object} corpo `req.body`
 * @param {object} [base] valores atuais (edicao)
 * @returns {object}
 */
const valoresDoCorpo = (corpo = {}, base = {}) => ({
    id: base.id || null,
    nome: corpo.nome !== undefined ? corpo.nome : base.nome || '',
    codigo: corpo.codigo !== undefined ? corpo.codigo : base.codigo || '',
    periodoLetivoId:
        corpo.periodoLetivoId !== undefined ? corpo.periodoLetivoId : base.periodo_letivo_id || '',
    campusId: corpo.campusId !== undefined ? corpo.campusId : base.campus_id || '',
    cursoId: corpo.cursoId !== undefined ? corpo.cursoId : base.curso_id || '',
    semestreCurricular:
        corpo.semestreCurricular !== undefined
            ? corpo.semestreCurricular
            : base.semestre_curricular || '',
    turnoId: corpo.turnoId !== undefined ? corpo.turnoId : base.turno_id || '',
    gerencial: corpo.gerencial !== undefined ? Boolean(corpo.gerencial) : base.gerencial === true,
    ativo: corpo.ativo !== undefined ? String(corpo.ativo) !== 'false' : base.ativo !== false,
});

/**
 * Renderiza o formulario (novo ou edicao).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{modo:'criar'|'editar', valores:object, erros?:object, status?:number,
 *          turma?:object}} opcoes
 */
const renderizarFormulario = async (req, res, opcoes) => {
    const { modo, valores, erros = {}, status = 200, turma = null } = opcoes;
    const edicao = modo === 'editar';

    const selecionados = {
        periodoLetivoId: Number.parseInt(valores.periodoLetivoId, 10) || null,
        campusId: Number.parseInt(valores.campusId, 10) || null,
        cursoId: Number.parseInt(valores.cursoId, 10) || null,
        turnoId: Number.parseInt(valores.turnoId, 10) || null,
    };

    const opcoesFormulario = await turmaService.opcoesFormulario(req.usuario, selecionados);

    res.status(status).render('admin/turmas/formulario', {
        tituloPagina: edicao ? 'Editar turma' : 'Nova turma',
        subtitulo: edicao ? valores.nome : 'Cadastro de turma',
        menuAtivo: 'turmas',
        breadcrumbs: trilha(
            { texto: 'Turmas', url: CAMINHO_LISTA },
            { texto: edicao ? 'Editar' : 'Nova' }
        ),
        modo,
        turma,
        valores,
        erros,
        opcoes: opcoesFormulario,
        semestres: SEMESTRES,
        acao: edicao ? `${CAMINHO_LISTA}/${valores.id}` : CAMINHO_LISTA,
    });
};

/** GET /admin/turmas */
const lista = async (req, res) => {
    const filtros = validar(schemaFiltros, req.query, 'Filtros inválidos.');
    const { pagina, porPagina } = paginacaoUtil.lerParametros(req.query);

    const [{ itens, paginacao, integradasOcultas }, opcoes] = await Promise.all([
        turmaService.listar(req.usuario, { ...filtros, pagina, porPagina }),
        turmaService.opcoesFiltros(req.usuario),
    ]);

    res.render('admin/turmas/lista', {
        tituloPagina: 'Turmas',
        subtitulo: 'Turmas cadastradas e suas grades',
        menuAtivo: 'turmas',
        breadcrumbs: trilha({ texto: 'Turmas' }),
        turmas: itens,
        paginacao,
        integradasOcultas,
        filtros,
        opcoes,
        semestres: SEMESTRES,
        urlBase: (numero) =>
            res.locals.withBase(
                `${CAMINHO_LISTA}${paginacaoUtil.queryString(req.query, { pagina: numero })}`
            ),
        // Preserva os filtros ao trocar o recorte de exibicao da listagem.
        urlComFiltros: (sobrescrever) =>
            res.locals.withBase(
                `${CAMINHO_LISTA}${paginacaoUtil.queryString(req.query, { pagina: '', ...sobrescrever })}`
            ),
    });
};

/** GET /admin/turmas/novo */
const formularioNovo = async (req, res) => {
    const periodo = res.locals.periodoAtual;

    await renderizarFormulario(req, res, {
        modo: 'criar',
        valores: {
            id: null,
            nome: '',
            codigo: '',
            // O periodo letivo atual ja vem selecionado.
            periodoLetivoId: periodo ? periodo.id : '',
            campusId: '',
            cursoId: '',
            semestreCurricular: '',
            turnoId: '',
            gerencial: false,
            ativo: true,
        },
    });
};

/** POST /admin/turmas */
const criar = async (req, res) => {
    try {
        const dados = validar(schemaTurma, req.body);
        const turma = await turmaService.criar(req.usuario, dados);

        req.flash('sucesso', `Turma "${turma.nome}" cadastrada com sucesso.`);
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

/** GET /admin/turmas/:id/editar */
const formularioEdicao = async (req, res) => {
    const turma = await turmaService.obter(req.usuario, req.params.id);

    await renderizarFormulario(req, res, {
        modo: 'editar',
        turma,
        valores: {
            id: turma.id,
            nome: turma.nome,
            codigo: turma.codigo || '',
            periodoLetivoId: turma.periodo_letivo_id,
            campusId: turma.campus_id,
            cursoId: turma.curso_id,
            semestreCurricular: turma.semestre_curricular,
            turnoId: turma.turno_id,
            gerencial: turma.gerencial === true,
            ativo: turma.ativo,
        },
    });
};

/** POST /admin/turmas/:id */
const atualizar = async (req, res) => {
    // Confere escopo e existencia antes de qualquer coisa (404/403 imediatos).
    const atual = await turmaService.obter(req.usuario, req.params.id);

    try {
        const dados = validar(schemaTurma, req.body);
        const turma = await turmaService.atualizar(req.usuario, atual.id, dados);

        req.flash('sucesso', `Turma "${turma.nome}" atualizada com sucesso.`);
        return res.redirect(res.locals.withBase(CAMINHO_LISTA));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;

        return renderizarFormulario(req, res, {
            modo: 'editar',
            turma: atual,
            valores: valoresDoCorpo(req.body, atual),
            erros: erro.campos || {},
            status: erro.status || 422,
        });
    }
};

/** POST /admin/turmas/:id/status */
const alterarStatus = async (req, res) => {
    const { ativo } = validar(schemaStatus, req.body, 'Situação inválida.');
    const turma = await turmaService.definirAtivo(req.usuario, req.params.id, ativo);

    req.flash('sucesso', `Turma "${turma.nome}" ${ativo ? 'reativada' : 'inativada'} com sucesso.`);
    res.redirect(res.locals.withBase(CAMINHO_LISTA));
};

/** POST /admin/turmas/:id/excluir */
const excluir = async (req, res) => {
    try {
        const turma = await turmaService.excluir(req.usuario, req.params.id);
        req.flash('sucesso', `Turma "${turma.nome}" excluída.`);
    } catch (erro) {
        // Turma com aulas nao pode ser excluida: a mensagem orienta a inativar.
        const conhecido =
            erro instanceof ErroDependencia ||
            (erro instanceof ErroAplicacao && erro.status === 409);

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
    alterarStatus,
    excluir,
};
