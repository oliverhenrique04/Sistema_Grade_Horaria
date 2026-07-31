/**
 * Painel administrativo: CRUD de disciplinas.
 *
 * Mesmos padroes dos demais controllers do painel: POST-Redirect-GET no sucesso,
 * reexibicao do formulario (422) quando a validacao falha e flash + redirect
 * quando a acao esbarra em dependencias.
 *
 * O formulario tambem mantem a matriz curricular: para cada curso marcado
 * (`cursosIds`) o campo `semestre_<cursoId>` informa o semestre sugerido.
 */
const { async, ErroValidacao, ErroDependencia } = require('../../utils/erros');
const { destinoInternoSeguro } = require('../../middlewares/contexto');
const { lerParametros, montar, queryString } = require('../../utils/paginacao');
const disciplinaService = require('../../services/disciplinaService');

const BASE = '/admin/disciplinas';
const MENU_ATIVO = 'disciplinas';

const trilha = (...extras) => [
    { texto: 'Painel', url: '/admin' },
    { texto: 'Disciplinas', url: BASE },
    ...extras,
];

const destinoDeRetorno = (req) =>
    destinoInternoSeguro((req.body || {}).retorno, req.withBase(BASE), req.basePath);

/**
 * Vinculos no formato que a view consome: mapa cursoId -> semestre sugerido.
 * @param {{curso_id:number, semestre_sugerido:number|null}[]} vinculos
 * @returns {{cursosIds:number[], semestres:Record<number, string>}}
 */
const vinculosParaFormulario = (vinculos = []) => {
    const semestres = {};
    const cursosIds = vinculos.map((vinculo) => {
        const cursoId = Number(vinculo.curso_id);
        semestres[cursoId] =
            vinculo.semestre_sugerido === null ? '' : String(vinculo.semestre_sugerido);
        return cursoId;
    });
    return { cursosIds, semestres };
};

/**
 * Valores do formulario a partir de uma disciplina ja gravada.
 * @param {object} disciplina
 * @param {object[]} vinculos
 */
const valoresDoRegistro = (disciplina, vinculos) => ({
    nome: disciplina.nome || '',
    codigo: disciplina.codigo || '',
    cargaHoraria: disciplina.carga_horaria === null ? '' : String(disciplina.carga_horaria),
    ativo: disciplina.ativo !== false,
    ...vinculosParaFormulario(vinculos),
});

/**
 * Valores do formulario a partir do que o usuario acabou de digitar.
 * Montado campo a campo: nada do `req.body` e copiado em bloco.
 * @param {Record<string, unknown>} corpo
 */
const valoresDoCorpo = (corpo = {}) => {
    const texto = (valor) => (typeof valor === 'string' ? valor : '');
    const brutos = corpo.cursosIds === undefined ? [] : [].concat(corpo.cursosIds);
    const cursosIds = brutos.map(Number).filter(Number.isInteger);

    const semestres = {};
    cursosIds.forEach((cursoId) => {
        semestres[cursoId] = texto(corpo[`semestre_${cursoId}`]);
    });

    return {
        nome: texto(corpo.nome),
        codigo: texto(corpo.codigo),
        cargaHoraria: texto(corpo.cargaHoraria),
        ativo: ['1', 'true', 'on', 'sim'].includes(String(corpo.ativo || '').toLowerCase()),
        cursosIds,
        semestres,
    };
};

/**
 * Renderiza o formulario de criacao/edicao.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{modo:'novo'|'edicao', disciplina?:object, valores:object,
 *          erros?:Record<string,string>, status?:number}} opcoes
 */
const renderizarFormulario = async (
    req,
    res,
    { modo, disciplina, valores, erros = {}, status = 200 }
) => {
    const cursos = await disciplinaService.listarCursos();
    const edicao = modo === 'edicao';

    res.status(status).render('admin/disciplinas/formulario', {
        tituloPagina: edicao ? 'Editar disciplina' : 'Nova disciplina',
        subtitulo: edicao ? disciplina.nome : 'Cadastro de uma nova disciplina',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha({ texto: edicao ? 'Editar' : 'Nova' }),
        modo,
        disciplina: disciplina || null,
        cursos,
        valores,
        erros,
        acaoFormulario: req.withBase(edicao ? `${BASE}/${disciplina.id}` : BASE),
        urlCancelar: req.withBase(BASE),
    });
};

/** GET /admin/disciplinas */
const lista = async(async (req, res) => {
    const parametros = lerParametros(req.query);
    const { itens, total, filtros } = await disciplinaService.listar(req.query, {
        limite: parametros.porPagina,
        offset: parametros.offset,
    });

    const paginacao = montar(parametros, total);

    if (paginacao.paginaAtual !== parametros.pagina) {
        return res.redirect(
            req.withBase(`${BASE}${queryString(req.query, { pagina: paginacao.paginaAtual })}`)
        );
    }

    const cursos = await disciplinaService.listarCursos();

    return res.render('admin/disciplinas/lista', {
        tituloPagina: 'Disciplinas',
        subtitulo: 'Disciplinas e matriz curricular dos cursos',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha(),
        itens,
        cursos,
        filtros,
        paginacao,
        urlBase: (pagina) => req.withBase(`${BASE}${queryString(req.query, { pagina })}`),
        urlNovo: req.withBase(`${BASE}/nova`),
        urlLimpar: req.withBase(BASE),
        retorno: req.originalUrl,
    });
});

/** GET /admin/disciplinas/nova */
const formularioNovo = async(async (req, res) => {
    await renderizarFormulario(req, res, {
        modo: 'novo',
        valores: {
            nome: '',
            codigo: '',
            cargaHoraria: '',
            ativo: true,
            cursosIds: [],
            semestres: {},
        },
    });
});

/** POST /admin/disciplinas */
const criar = async(async (req, res) => {
    try {
        const disciplina = await disciplinaService.criar(req.body);
        req.flash('sucesso', `Disciplina "${disciplina.nome}" cadastrada com sucesso.`);
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

/** GET /admin/disciplinas/:id/editar */
const formularioEditar = async(async (req, res) => {
    const { disciplina, vinculos } = await disciplinaService.obterParaFormulario(req.params.id);
    await renderizarFormulario(req, res, {
        modo: 'edicao',
        disciplina,
        valores: valoresDoRegistro(disciplina, vinculos),
    });
});

/** POST /admin/disciplinas/:id */
const atualizar = async(async (req, res) => {
    try {
        const disciplina = await disciplinaService.atualizar(req.params.id, req.body);
        req.flash('sucesso', `Disciplina "${disciplina.nome}" atualizada.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        const disciplina = await disciplinaService.obter(req.params.id);
        return renderizarFormulario(req, res, {
            modo: 'edicao',
            disciplina,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos,
            status: erro.status,
        });
    }
});

/** POST /admin/disciplinas/:id/status */
const alterarStatus = async(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';
    const { disciplina, aulasAtivas } = await disciplinaService.definirAtivo(req.params.id, ativar);

    req.flash('sucesso', `Disciplina "${disciplina.nome}" ${ativar ? 'reativada' : 'inativada'}.`);

    if (!ativar && aulasAtivas > 0) {
        req.flash(
            'aviso',
            `"${disciplina.nome}" continua em ${aulasAtivas} aula(s) ativa(s) da grade; novas aulas não poderão usá-la.`
        );
    }

    return res.redirect(destinoDeRetorno(req));
});

/** POST /admin/disciplinas/:id/excluir */
const excluir = async(async (req, res) => {
    try {
        const disciplina = await disciplinaService.excluir(req.params.id);
        req.flash('sucesso', `Disciplina "${disciplina.nome}" excluída.`);
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
