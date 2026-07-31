/**
 * Painel administrativo: CRUD de cursos.
 *
 * O controller e fino — le a requisicao, chama o service e escolhe o que
 * renderizar. Toda regra de negocio e SQL ficam nas camadas de baixo.
 *
 * Padroes adotados:
 *  - sucesso em POST => `req.flash` + redirect (POST-Redirect-GET);
 *  - erro de validacao => o proprio formulario e reexibido com status 422,
 *    mostrando o que foi digitado e a mensagem de cada campo;
 *  - erro de dependencia => `req.flash('erro', ...)` + redirect para a listagem;
 *  - qualquer outro erro sobe para o tratador global (`utils/erros#async`).
 */
const { async, ErroValidacao, ErroDependencia } = require('../../utils/erros');
const { destinoInternoSeguro } = require('../../middlewares/contexto');
const { lerParametros, montar, queryString } = require('../../utils/paginacao');
const cursoService = require('../../services/cursoService');

const BASE = '/admin/cursos';
const MENU_ATIVO = 'cursos';

/** Trilha comum a todas as telas do recurso. */
const trilha = (...extras) => [
    { texto: 'Painel', url: '/admin' },
    { texto: 'Cursos', url: BASE },
    ...extras,
];

/** Para onde voltar depois de uma acao da listagem (preserva filtros e pagina). */
const destinoDeRetorno = (req) =>
    destinoInternoSeguro((req.body || {}).retorno, req.withBase(BASE), req.basePath);

/**
 * Valores do formulario a partir de um curso ja gravado.
 * @param {object} curso
 * @param {number[]} campusIds
 */
const valoresDoRegistro = (curso, campusIds) => ({
    nome: curso.nome || '',
    sigla: curso.sigla || '',
    coordenador: curso.coordenador || '',
    semestresTotal: curso.semestres_total,
    ativo: curso.ativo !== false,
    campusIds: campusIds.map(Number),
});

/**
 * Valores do formulario a partir do que o usuario acabou de digitar.
 * Montado campo a campo: nada do `req.body` e copiado em bloco.
 * @param {Record<string, unknown>} corpo
 */
const valoresDoCorpo = (corpo = {}) => {
    const lista = corpo.campusIds === undefined ? [] : [].concat(corpo.campusIds);
    return {
        nome: typeof corpo.nome === 'string' ? corpo.nome : '',
        sigla: typeof corpo.sigla === 'string' ? corpo.sigla : '',
        coordenador: typeof corpo.coordenador === 'string' ? corpo.coordenador : '',
        semestresTotal: typeof corpo.semestresTotal === 'string' ? corpo.semestresTotal : '',
        ativo: ['1', 'true', 'on', 'sim'].includes(String(corpo.ativo || '').toLowerCase()),
        campusIds: lista.map(Number).filter(Number.isInteger),
    };
};

/**
 * Renderiza o formulario de criacao/edicao.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{modo:'novo'|'edicao', curso?:object, valores:object,
 *          erros?:Record<string,string>, status?:number}} opcoes
 */
const renderizarFormulario = async (
    req,
    res,
    { modo, curso, valores, erros = {}, status = 200 }
) => {
    const campus = await cursoService.listarCampus();
    const edicao = modo === 'edicao';

    res.status(status).render('admin/cursos/formulario', {
        tituloPagina: edicao ? 'Editar curso' : 'Novo curso',
        subtitulo: edicao ? curso.nome : 'Cadastro de um novo curso',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha({ texto: edicao ? 'Editar' : 'Novo' }),
        modo,
        curso: curso || null,
        campus,
        valores,
        erros,
        acaoFormulario: req.withBase(edicao ? `${BASE}/${curso.id}` : BASE),
        urlCancelar: req.withBase(BASE),
    });
};

/** GET /admin/cursos */
const lista = async(async (req, res) => {
    const parametros = lerParametros(req.query);
    const { itens, total, filtros } = await cursoService.listar(req.query, {
        limite: parametros.porPagina,
        offset: parametros.offset,
    });

    const paginacao = montar(parametros, total);

    // Pagina alem do fim (filtro mudou, registros sumiram): volta para a ultima.
    if (paginacao.paginaAtual !== parametros.pagina) {
        return res.redirect(
            req.withBase(`${BASE}${queryString(req.query, { pagina: paginacao.paginaAtual })}`)
        );
    }

    const campus = await cursoService.listarCampus();

    return res.render('admin/cursos/lista', {
        tituloPagina: 'Cursos',
        subtitulo: 'Cursos ofertados e seus campus',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha(),
        itens,
        campus,
        filtros,
        paginacao,
        urlBase: (pagina) => req.withBase(`${BASE}${queryString(req.query, { pagina })}`),
        urlNovo: req.withBase(`${BASE}/novo`),
        urlLimpar: req.withBase(BASE),
        retorno: req.originalUrl,
    });
});

/** GET /admin/cursos/novo */
const formularioNovo = async(async (req, res) => {
    await renderizarFormulario(req, res, {
        modo: 'novo',
        valores: {
            nome: '',
            sigla: '',
            coordenador: '',
            semestresTotal: 8,
            ativo: true,
            campusIds: [],
        },
    });
});

/** POST /admin/cursos */
const criar = async(async (req, res) => {
    try {
        const curso = await cursoService.criar(req.body);
        req.flash('sucesso', `Curso "${curso.nome}" cadastrado com sucesso.`);
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

/** GET /admin/cursos/:id/editar */
const formularioEditar = async(async (req, res) => {
    const { curso, campusIds } = await cursoService.obterParaFormulario(req.params.id);
    await renderizarFormulario(req, res, {
        modo: 'edicao',
        curso,
        valores: valoresDoRegistro(curso, campusIds),
    });
});

/** POST /admin/cursos/:id */
const atualizar = async(async (req, res) => {
    try {
        const curso = await cursoService.atualizar(req.params.id, req.body);
        req.flash('sucesso', `Curso "${curso.nome}" atualizado.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        const curso = await cursoService.obter(req.params.id);
        return renderizarFormulario(req, res, {
            modo: 'edicao',
            curso,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos,
            status: erro.status,
        });
    }
});

/** POST /admin/cursos/:id/status */
const alterarStatus = async(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';

    try {
        const curso = await cursoService.definirAtivo(req.params.id, ativar);
        req.flash('sucesso', `Curso "${curso.nome}" ${ativar ? 'reativado' : 'inativado'}.`);
    } catch (erro) {
        if (!(erro instanceof ErroDependencia)) throw erro;
        req.flash('erro', erro.message);
    }

    return res.redirect(destinoDeRetorno(req));
});

/** POST /admin/cursos/:id/excluir */
const excluir = async(async (req, res) => {
    try {
        const curso = await cursoService.excluir(req.params.id);
        req.flash('sucesso', `Curso "${curso.nome}" excluído.`);
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
