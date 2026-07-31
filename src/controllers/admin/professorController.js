/**
 * Painel administrativo: CRUD de professores.
 *
 * Mesmos padroes dos demais controllers do painel: POST-Redirect-GET no sucesso,
 * reexibicao do formulario (422) quando a validacao falha e flash + redirect
 * quando a acao esbarra em dependencias.
 *
 * Ao inativar um professor a acao nao e bloqueada, mas o usuario e avisado de
 * quantas aulas ativas ele ainda possui.
 */
const { async, ErroValidacao, ErroDependencia } = require('../../utils/erros');
const { destinoInternoSeguro } = require('../../middlewares/contexto');
const { lerParametros, montar, queryString } = require('../../utils/paginacao');
const professorService = require('../../services/professorService');

const BASE = '/admin/professores';
const MENU_ATIVO = 'professores';

const trilha = (...extras) => [
    { texto: 'Painel', url: '/admin' },
    { texto: 'Professores', url: BASE },
    ...extras,
];

const destinoDeRetorno = (req) =>
    destinoInternoSeguro((req.body || {}).retorno, req.withBase(BASE), req.basePath);

/**
 * Valores do formulario a partir de um professor ja gravado.
 * @param {object} professor
 */
const valoresDoRegistro = (professor) => ({
    nome: professor.nome || '',
    email: professor.email || '',
    ativo: professor.ativo !== false,
});

/**
 * Valores do formulario a partir do que o usuario acabou de digitar.
 * Montado campo a campo: nada do `req.body` e copiado em bloco.
 * @param {Record<string, unknown>} corpo
 */
const valoresDoCorpo = (corpo = {}) => ({
    nome: typeof corpo.nome === 'string' ? corpo.nome : '',
    email: typeof corpo.email === 'string' ? corpo.email : '',
    ativo: ['1', 'true', 'on', 'sim'].includes(String(corpo.ativo || '').toLowerCase()),
});

/**
 * Renderiza o formulario de criacao/edicao.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{modo:'novo'|'edicao', professor?:object, valores:object,
 *          erros?:Record<string,string>, status?:number}} opcoes
 */
const renderizarFormulario = (req, res, { modo, professor, valores, erros = {}, status = 200 }) => {
    const edicao = modo === 'edicao';

    res.status(status).render('admin/professores/formulario', {
        tituloPagina: edicao ? 'Editar professor' : 'Novo professor',
        subtitulo: edicao ? professor.nome : 'Cadastro de um novo professor',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha({ texto: edicao ? 'Editar' : 'Novo' }),
        modo,
        professor: professor || null,
        valores,
        erros,
        acaoFormulario: req.withBase(edicao ? `${BASE}/${professor.id}` : BASE),
        urlCancelar: req.withBase(BASE),
    });
};

/** GET /admin/professores */
const lista = async(async (req, res) => {
    const parametros = lerParametros(req.query);
    const { itens, total, filtros } = await professorService.listar(req.query, {
        limite: parametros.porPagina,
        offset: parametros.offset,
    });

    const paginacao = montar(parametros, total);

    if (paginacao.paginaAtual !== parametros.pagina) {
        return res.redirect(
            req.withBase(`${BASE}${queryString(req.query, { pagina: paginacao.paginaAtual })}`)
        );
    }

    return res.render('admin/professores/lista', {
        tituloPagina: 'Professores',
        subtitulo: 'Docentes disponíveis para a grade horária',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha(),
        itens,
        filtros,
        paginacao,
        urlBase: (pagina) => req.withBase(`${BASE}${queryString(req.query, { pagina })}`),
        urlNovo: req.withBase(`${BASE}/novo`),
        urlLimpar: req.withBase(BASE),
        retorno: req.originalUrl,
    });
});

/** GET /admin/professores/novo */
const formularioNovo = async(async (req, res) => {
    renderizarFormulario(req, res, {
        modo: 'novo',
        valores: { nome: '', email: '', ativo: true },
    });
});

/** POST /admin/professores */
const criar = async(async (req, res) => {
    try {
        const professor = await professorService.criar(req.body);
        req.flash('sucesso', `Professor "${professor.nome}" cadastrado com sucesso.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        return renderizarFormulario(req, res, {
            modo: 'novo',
            valores: valoresDoCorpo(req.body),
            erros: erro.campos,
            status: erro.status,
        });
    }
});

/** GET /admin/professores/:id/editar */
const formularioEditar = async(async (req, res) => {
    const professor = await professorService.obter(req.params.id);
    renderizarFormulario(req, res, {
        modo: 'edicao',
        professor,
        valores: valoresDoRegistro(professor),
    });
});

/** POST /admin/professores/:id */
const atualizar = async(async (req, res) => {
    try {
        const professor = await professorService.atualizar(req.params.id, req.body);
        req.flash('sucesso', `Professor "${professor.nome}" atualizado.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        const professor = await professorService.obter(req.params.id);
        return renderizarFormulario(req, res, {
            modo: 'edicao',
            professor,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos,
            status: erro.status,
        });
    }
});

/** POST /admin/professores/:id/status */
const alterarStatus = async(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';
    const { professor, aulasAtivas } = await professorService.definirAtivo(req.params.id, ativar);

    req.flash('sucesso', `Professor "${professor.nome}" ${ativar ? 'reativado' : 'inativado'}.`);

    if (!ativar && aulasAtivas > 0) {
        req.flash(
            'aviso',
            `"${professor.nome}" continua com ${aulasAtivas} aula(s) ativa(s) na grade; novas aulas não poderão ser atribuídas a ele.`
        );
    }

    return res.redirect(destinoDeRetorno(req));
});

/** POST /admin/professores/:id/excluir */
const excluir = async(async (req, res) => {
    try {
        const professor = await professorService.excluir(req.params.id);
        req.flash('sucesso', `Professor "${professor.nome}" excluído.`);
    } catch (erro) {
        if (!(erro instanceof ErroDependencia)) throw erro;
        req.flash('erro', erro.message);
    }

    return res.redirect(destinoDeRetorno(req));
});

module.exports = {
    lista,
    formularioNovo,
    criar,
    formularioEditar,
    atualizar,
    alterarStatus,
    excluir,
};
