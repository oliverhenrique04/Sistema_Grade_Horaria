/**
 * Area publica de consulta da grade horaria.
 *
 * Controlador fino: sanea a query string, delega ao servico e renderiza. Sem
 * SQL, sem regra de negocio e sem try/catch — o tratador global responde.
 */
const { async: envolver } = require('../utils/erros');
const validador = require('../validators/publico');
const servico = require('../services/gradePublicaService');

const TITULO_BASE = 'Grade Horária';

/**
 * Monta uma URL da area publica a partir dos filtros ja validados.
 * @param {(caminho:string) => string} withBase helper de BASE_PATH
 * @param {object} [filtros]
 * @param {string} [caminho='/'] rota de destino ('/' ou '/imprimir')
 * @returns {string}
 */
const construirUrl = (withBase, filtros = {}, caminho = '/') => {
    const parametros = new URLSearchParams();

    const adicionar = (nome, valor) => {
        if (valor === undefined || valor === null || valor === '') return;
        parametros.set(nome, String(valor));
    };

    adicionar('periodo', filtros.periodoId);
    adicionar('campus', filtros.campusId);
    adicionar('curso', filtros.cursoId);
    adicionar('semestre', filtros.semestre);
    adicionar('turno', filtros.turnoId);
    adicionar('turma', filtros.turmaId);

    const consulta = parametros.toString();
    return withBase(consulta ? `${caminho}?${consulta}` : caminho);
};

/** Titulo da aba, sempre com o periodo letivo vindo do banco. */
const montarTitulo = (filtrosAplicados) => {
    const codigo = filtrosAplicados?.periodo?.codigo;
    return codigo ? `${TITULO_BASE} · ${codigo}` : TITULO_BASE;
};

/**
 * Redireciona os links antigos (`?unidade=<slug>&curso=<slug>`) para a URL
 * atual, baseada em ids. Responde `true` quando ja tratou a resposta.
 *
 * O redirecionamento e 302 (temporario) de proposito: a equivalencia
 * slug -> id depende do cadastro e muda se o campus ou o curso for renomeado,
 * entao nao interessa que navegadores e buscadores guardem o destino em cache
 * permanente, como fariam com um 301.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} caminho rota de destino do redirecionamento
 * @returns {Promise<boolean>}
 */
const redirecionarLegado = async (req, res, caminho) => {
    if (!validador.temParametrosLegados(req.query)) return false;

    const filtros = validador.validarConsulta(req.query);
    const { unidadeSlug, cursoSlug } = validador.validarLegado(req.query);

    const resolvidos = await servico.resolverFiltrosLegados({
        unidadeSlug,
        cursoSlug,
        periodoId: filtros.periodoId,
    });

    const destino = construirUrl(
        req.withBase,
        { ...filtros, campusId: resolvidos.campusId, cursoId: resolvidos.cursoId },
        caminho
    );

    res.redirect(302, destino);
    return true;
};

/**
 * Renderiza a consulta em modo normal ou em modo de impressao.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{modoImpressao:boolean}} opcoes
 */
const renderizar = async (req, res, { modoImpressao }) => {
    const filtros = validador.validarConsulta(req.query);
    const consulta = await servico.montarConsulta(filtros);

    res.render('publico/index', {
        ...consulta,
        tituloPagina: montarTitulo(consulta.filtrosAplicados),
        modoImpressao,
        urlConsulta: construirUrl(req.withBase, consulta.filtrosAplicados, '/'),
        urlImpressao: construirUrl(req.withBase, consulta.filtrosAplicados, '/imprimir'),
    });
};

/** GET / — consulta publica com filtros encadeados. */
const consultar = envolver(async (req, res) => {
    if (await redirecionarLegado(req, res, '/')) return;
    await renderizar(req, res, { modoImpressao: false });
});

/** GET /imprimir — mesma grade, sem filtros nem navegacao, pronta para papel. */
const imprimir = envolver(async (req, res) => {
    if (await redirecionarLegado(req, res, '/imprimir')) return;
    await renderizar(req, res, { modoImpressao: true });
});

module.exports = { consultar, imprimir, construirUrl };
