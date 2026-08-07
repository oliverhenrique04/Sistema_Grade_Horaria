/**
 * Paineis de TV (/admin/paineis).
 *
 * Cada TV do campus e um registro: a tela aponta para `/painel/<slug>` e o
 * recorte mora no banco. Corrigir o que uma TV mostra passou a ser editar aqui,
 * e nao subir numa escada com um teclado.
 *
 * O escopo por campus vale para o `nap`: ele lista, cria e edita apenas os
 * paineis dos campus vinculados a ele. A verificacao acontece no backend, em
 * toda acao — esconder o botao na view e conveniencia.
 */
const servico = require('../../services/painelService');
const validador = require('../../validators/painel');
const repositorio = require('../../repositories/painelRepository');
const { podeAcessarCampus } = require('../../middlewares/autorizacao');
const { urlAbsoluta } = require('../../utils/urls');
const { ErroNaoEncontrado, ErroPermissao, async: assincrono } = require('../../utils/erros');

const MENU = 'paineis';
const BASE = '/admin/paineis';

/** Campus que o usuario enxerga; `null` para quem nao e limitado por campus. */
const campusDoEscopo = (usuario) =>
    usuario && usuario.perfil === 'nap' ? usuario.campusIds || [] : null;

/**
 * Carrega o painel garantindo escopo. Distingue "nao existe" de "sem
 * permissao", como o resto do sistema faz.
 */
const carregarPainel = async (req) => {
    const painel = await repositorio.buscarPainelPorId(req.params.id);
    if (!painel) throw new ErroNaoEncontrado('Painel não encontrado.');

    if (!podeAcessarCampus(req.usuario, painel.campus_id)) {
        throw new ErroPermissao('Você não tem permissão para acessar este painel.');
    }
    return painel;
};

/** Endereco completo da TV, que e o que se cola no aparelho. */
const enderecoDoPainel = (req, slug) => urlAbsoluta(req, `/painel/${slug}`);

/** GET /admin/paineis — as TVs cadastradas. */
const lista = assincrono(async (req, res) => {
    const paineis = await repositorio.listarPaineis({ campusIds: campusDoEscopo(req.usuario) });

    res.render('admin/paineis/lista', {
        tituloPagina: 'TVs dos blocos',
        menuAtivo: MENU,
        breadcrumbs: [{ texto: 'TVs dos blocos' }],
        paineis: paineis.map((painel) => ({
            ...painel,
            resumo: servico.resumoDoRecorte(painel),
            endereco: enderecoDoPainel(req, painel.slug),
            caminho: req.withBase(`/painel/${painel.slug}`),
        })),
    });
});

/**
 * Monta a tela do formulario. `valores` sempre vem do que o operador digitou —
 * um erro de validacao nao pode devolver a tela em branco.
 */
const renderizarFormulario = async (req, res, { status = 200, registro, valores, erros = {} }) => {
    const opcoes = await servico.opcoesDoGerador({ campusId: valores.campus_id }, (campusId) =>
        podeAcessarCampus(req.usuario, campusId)
    );

    const edicao = Boolean(registro);

    res.status(status).render('admin/paineis/formulario', {
        tituloPagina: edicao ? 'Editar painel' : 'Novo painel',
        menuAtivo: MENU,
        breadcrumbs: [
            { texto: 'TVs dos blocos', url: BASE },
            { texto: edicao ? valores.titulo || 'Editar' : 'Novo painel' },
        ],
        registro,
        valores,
        erros,
        opcoes,
        // Conjuntos para a view marcar as caixas sem varrer array a cada item.
        marcados: {
            blocos: new Set(valores.blocos || []),
            locais: new Set(valores.locais_ids || []),
            cursos: new Set(valores.cursos_ids || []),
            turmas: new Set(valores.turmas_ids || []),
            turnos: new Set(valores.turnos_ids || []),
            dias: new Set(valores.dias || []),
        },
        acao: edicao ? req.withBase(`${BASE}/${registro.id}`) : req.withBase(BASE),
        endereco: edicao ? enderecoDoPainel(req, registro.slug) : '',
        caminho: edicao ? req.withBase(`/painel/${registro.slug}`) : '',
        limiteTitulo: validador.TITULO_MAXIMO,
        scriptsExtras: ['/js/paineis.js'],
    });
};

/** Valores em branco de um painel novo. */
const valoresNovos = (campusId) => ({
    titulo: '',
    slug: '',
    campus_id: campusId || null,
    blocos: [],
    locais_ids: [],
    cursos_ids: [],
    turmas_ids: [],
    turnos_ids: [],
    dias: [],
    incluir_sem_local: true,
    ativo: true,
});

/** Valores de um registro existente, no formato do formulario. */
const valoresDoRegistro = (painel) => ({
    titulo: painel.titulo,
    slug: painel.slug,
    campus_id: Number(painel.campus_id),
    blocos: painel.blocos || [],
    locais_ids: (painel.locais_ids || []).map(Number),
    cursos_ids: (painel.cursos_ids || []).map(Number),
    turmas_ids: (painel.turmas_ids || []).map(Number),
    turnos_ids: (painel.turnos_ids || []).map(Number),
    dias: (painel.dias || []).map(Number),
    incluir_sem_local: painel.incluir_sem_local !== false,
    ativo: painel.ativo !== false,
});

/** GET /admin/paineis/novo */
const novo = assincrono(async (req, res) => {
    const campusId = /^\d+$/.test(String(req.query.campus || '')) ? Number(req.query.campus) : null;
    await renderizarFormulario(req, res, { registro: null, valores: valoresNovos(campusId) });
});

/** GET /admin/paineis/:id/editar */
const editar = assincrono(async (req, res) => {
    const painel = await carregarPainel(req);
    await renderizarFormulario(req, res, {
        registro: painel,
        valores: valoresDoRegistro(painel),
    });
});

/**
 * Valida, confere escopo e unicidade do slug. Devolve os erros em vez de
 * lanca-los: o formulario precisa voltar preenchido.
 */
const conferir = async (req, dados, exceto = null) => {
    const erros = {};

    if (dados.campus_id && !podeAcessarCampus(req.usuario, dados.campus_id)) {
        erros.campus_id = 'Você não tem permissão para criar painéis neste campus.';
    }
    if (dados.slug && (await repositorio.slugEmUso(dados.slug, exceto))) {
        erros.slug = 'Já existe um painel com este endereço. Escolha outro nome.';
    }
    return erros;
};

/** POST /admin/paineis */
const criar = assincrono(async (req, res) => {
    const { dados, erros } = validador.validarPainelSalvo(req.body);
    const conflitos = { ...erros, ...(await conferir(req, dados)) };

    if (Object.keys(conflitos).length > 0) {
        return renderizarFormulario(req, res, {
            status: 422,
            registro: null,
            valores: dados,
            erros: conflitos,
        });
    }

    const painel = await repositorio.criarPainel(dados);
    req.flash('sucesso', `Painel "${painel.titulo}" criado.`);
    return res.redirect(req.withBase(`${BASE}/${painel.id}/editar`));
});

/** POST /admin/paineis/:id */
const atualizar = assincrono(async (req, res) => {
    const painel = await carregarPainel(req);
    const { dados, erros } = validador.validarPainelSalvo(req.body);
    const conflitos = { ...erros, ...(await conferir(req, dados, painel.id)) };

    if (Object.keys(conflitos).length > 0) {
        return renderizarFormulario(req, res, {
            status: 422,
            registro: painel,
            valores: dados,
            erros: conflitos,
        });
    }

    await repositorio.atualizarPainel(painel.id, dados);
    req.flash('sucesso', `Painel "${dados.titulo}" atualizado.`);
    return res.redirect(req.withBase(`${BASE}/${painel.id}/editar`));
});

/** POST /admin/paineis/:id/situacao */
const alterarSituacao = assincrono(async (req, res) => {
    const painel = await carregarPainel(req);
    const ativo = String(req.body.ativo) !== '0';

    await repositorio.alterarSituacaoPainel(painel.id, ativo);
    req.flash('sucesso', `Painel "${painel.titulo}" ${ativo ? 'reativado' : 'desativado'}.`);
    return res.redirect(req.withBase(BASE));
});

module.exports = { lista, novo, editar, criar, atualizar, alterarSituacao, enderecoDoPainel };
