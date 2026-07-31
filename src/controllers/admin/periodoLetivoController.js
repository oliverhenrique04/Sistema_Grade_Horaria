/**
 * Painel administrativo: CRUD de periodos letivos.
 *
 * Mesmos padroes dos demais controllers do painel: POST-Redirect-GET no sucesso,
 * reexibicao do formulario (422) quando a validacao falha e flash + redirect
 * quando a acao esbarra em dependencias.
 *
 * Alem do CRUD, a listagem oferece a acao "Definir como período atual", que
 * troca o periodo vigente do sistema numa unica transacao.
 */
const { async, ErroValidacao, ErroDependencia } = require('../../utils/erros');
const { destinoInternoSeguro } = require('../../middlewares/contexto');
const { lerParametros, montar, queryString } = require('../../utils/paginacao');
const periodoLetivoService = require('../../services/periodoLetivoService');

const BASE = '/admin/periodos';
const MENU_ATIVO = 'periodos';

const trilha = (...extras) => [
    { texto: 'Painel', url: '/admin' },
    { texto: 'Períodos letivos', url: BASE },
    ...extras,
];

const destinoDeRetorno = (req) =>
    destinoInternoSeguro((req.body || {}).retorno, req.withBase(BASE), req.basePath);

/** Datas do PostgreSQL chegam como Date; o input type="date" espera "AAAA-MM-DD". */
const paraIso = (valor) => {
    if (!valor) return '';
    if (valor instanceof Date) return valor.toISOString().slice(0, 10);
    return String(valor).slice(0, 10);
};

/**
 * Valores do formulario a partir de um periodo ja gravado.
 * @param {object} periodo
 */
const valoresDoRegistro = (periodo) => ({
    codigo: periodo.codigo || '',
    ano: periodo.ano,
    semestre: periodo.semestre,
    dataInicio: paraIso(periodo.data_inicio),
    dataFim: paraIso(periodo.data_fim),
    atual: periodo.atual === true,
    ativo: periodo.ativo !== false,
});

/**
 * Valores do formulario a partir do que o usuario acabou de digitar.
 * Montado campo a campo: nada do `req.body` e copiado em bloco.
 * @param {Record<string, unknown>} corpo
 */
const valoresDoCorpo = (corpo = {}) => {
    const texto = (valor) => (typeof valor === 'string' ? valor : '');
    const marcado = (valor) =>
        ['1', 'true', 'on', 'sim'].includes(String(valor || '').toLowerCase());

    return {
        codigo: texto(corpo.codigo),
        ano: texto(corpo.ano),
        semestre: texto(corpo.semestre),
        dataInicio: texto(corpo.dataInicio),
        dataFim: texto(corpo.dataFim),
        atual: marcado(corpo.atual),
        ativo: marcado(corpo.ativo),
    };
};

/**
 * Renderiza o formulario de criacao/edicao.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{modo:'novo'|'edicao', periodo?:object, valores:object,
 *          erros?:Record<string,string>, status?:number}} opcoes
 */
const renderizarFormulario = (req, res, { modo, periodo, valores, erros = {}, status = 200 }) => {
    const edicao = modo === 'edicao';

    res.status(status).render('admin/periodos/formulario', {
        tituloPagina: edicao ? 'Editar período letivo' : 'Novo período letivo',
        subtitulo: edicao ? periodo.codigo : 'Cadastro de um novo período letivo',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha({ texto: edicao ? 'Editar' : 'Novo' }),
        modo,
        periodo: periodo || null,
        valores,
        erros,
        acaoFormulario: req.withBase(edicao ? `${BASE}/${periodo.id}` : BASE),
        urlCancelar: req.withBase(BASE),
    });
};

/** GET /admin/periodos */
const lista = async(async (req, res) => {
    const parametros = lerParametros(req.query);
    const { itens, total, filtros } = await periodoLetivoService.listar(req.query, {
        limite: parametros.porPagina,
        offset: parametros.offset,
    });

    const paginacao = montar(parametros, total);

    if (paginacao.paginaAtual !== parametros.pagina) {
        return res.redirect(
            req.withBase(`${BASE}${queryString(req.query, { pagina: paginacao.paginaAtual })}`)
        );
    }

    const anos = await periodoLetivoService.listarAnos();

    return res.render('admin/periodos/lista', {
        tituloPagina: 'Períodos letivos',
        subtitulo: 'Semestres administrados pelo sistema',
        menuAtivo: MENU_ATIVO,
        breadcrumbs: trilha(),
        itens,
        anos,
        filtros,
        paginacao,
        urlBase: (pagina) => req.withBase(`${BASE}${queryString(req.query, { pagina })}`),
        urlNovo: req.withBase(`${BASE}/novo`),
        urlLimpar: req.withBase(BASE),
        retorno: req.originalUrl,
    });
});

/** GET /admin/periodos/novo */
const formularioNovo = async(async (req, res) => {
    renderizarFormulario(req, res, {
        modo: 'novo',
        valores: {
            codigo: '',
            ano: '',
            semestre: '',
            dataInicio: '',
            dataFim: '',
            atual: false,
            ativo: true,
        },
    });
});

/** POST /admin/periodos */
const criar = async(async (req, res) => {
    try {
        const periodo = await periodoLetivoService.criar(req.body);
        req.flash('sucesso', `Período letivo "${periodo.codigo}" cadastrado com sucesso.`);
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

/** GET /admin/periodos/:id/editar */
const formularioEditar = async(async (req, res) => {
    const periodo = await periodoLetivoService.obter(req.params.id);
    renderizarFormulario(req, res, {
        modo: 'edicao',
        periodo,
        valores: valoresDoRegistro(periodo),
    });
});

/** POST /admin/periodos/:id */
const atualizar = async(async (req, res) => {
    try {
        const periodo = await periodoLetivoService.atualizar(req.params.id, req.body);
        req.flash('sucesso', `Período letivo "${periodo.codigo}" atualizado.`);
        return res.redirect(req.withBase(BASE));
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        const periodo = await periodoLetivoService.obter(req.params.id);
        return renderizarFormulario(req, res, {
            modo: 'edicao',
            periodo,
            valores: valoresDoCorpo(req.body),
            erros: erro.campos,
            status: erro.status,
        });
    }
});

/** POST /admin/periodos/:id/atual */
const definirAtual = async(async (req, res) => {
    const periodo = await periodoLetivoService.definirAtual(req.params.id);
    req.flash('sucesso', `"${periodo.codigo}" agora é o período letivo atual.`);
    return res.redirect(destinoDeRetorno(req));
});

/** POST /admin/periodos/:id/status */
const alterarStatus = async(async (req, res) => {
    const ativar = String(req.body.ativo) === '1';

    try {
        const periodo = await periodoLetivoService.definirAtivo(req.params.id, ativar);
        req.flash('sucesso', `Período "${periodo.codigo}" ${ativar ? 'reativado' : 'inativado'}.`);
    } catch (erro) {
        if (!(erro instanceof ErroDependencia)) throw erro;
        req.flash('erro', erro.message);
    }

    return res.redirect(destinoDeRetorno(req));
});

/** POST /admin/periodos/:id/excluir */
const excluir = async(async (req, res) => {
    try {
        const periodo = await periodoLetivoService.excluir(req.params.id);
        req.flash('sucesso', `Período letivo "${periodo.codigo}" excluído.`);
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
    definirAtual,
    alterarStatus,
    excluir,
};
