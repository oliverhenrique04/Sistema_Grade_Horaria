/**
 * Controller da importacao de grade (`/admin/importacao`).
 *
 * Fluxo em duas etapas, deliberado: enviar a planilha nunca grava nada. O
 * primeiro POST simula a carga inteira e devolve o relatorio; a gravacao so
 * acontece quando o operador confirma, na tela seguinte, o que vai acontecer.
 *
 * O arquivo enviado fica guardado no servidor entre as duas etapas para nao
 * exigir um segundo upload — ver `services/importacao/arquivoTemporario.js`.
 */
const importacaoService = require('../../services/importacaoService');
const arquivoTemporario = require('../../services/importacao/arquivoTemporario');
const { ErroValidacao } = require('../../utils/erros');
const { schemaEnvio, validar } = require('../../validators/importacao');

const CAMINHO = '/admin/importacao';

const trilha = (...itens) => [{ texto: 'Painel', url: '/admin' }, ...itens];

/**
 * Renderiza a tela inicial de envio.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{erros?:object, valores?:object, status?:number}} [opcoes]
 */
const renderizarEnvio = async (req, res, { erros = {}, valores = {}, status = 200 } = {}) => {
    const [periodos, historico] = await Promise.all([
        importacaoService.periodosDisponiveis(),
        importacaoService.historico(8),
    ]);

    res.status(status).render('admin/importacao/index', {
        tituloPagina: 'Importar grade',
        subtitulo: 'Carga da grade horária a partir do cubo do TOTVS',
        menuAtivo: 'importacao',
        breadcrumbs: trilha({ texto: 'Importar grade' }),
        periodos,
        historico,
        erros,
        valores: {
            periodoLetivoId: valores.periodoLetivoId ?? '',
            inativarAusentes: valores.inativarAusentes === true,
        },
        acao: CAMINHO,
        scriptsExtras: ['/js/importacao.js'],
    });
};

/** GET /admin/importacao */
const inicio = async (req, res) => {
    await renderizarEnvio(req, res);
};

/** POST /admin/importacao — recebe a planilha e simula a carga. */
const analisar = async (req, res) => {
    let opcoes;

    try {
        opcoes = validar(schemaEnvio, req.body);

        if (req.arquivoRecusado) {
            throw new ErroValidacao('Arquivo não aceito.', { arquivo: req.arquivoRecusado });
        }

        if (!req.arquivo || req.arquivo.tamanho === 0) {
            throw new ErroValidacao('Selecione a planilha.', {
                arquivo: 'Escolha o arquivo .xlsx exportado do cubo.',
            });
        }
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        return renderizarEnvio(req, res, {
            erros: erro.campos || {},
            valores: req.body,
            status: erro.status || 422,
        });
    }

    let relatorio;
    try {
        relatorio = await importacaoService.simular(req.arquivo.conteudo, opcoes);
    } catch (erro) {
        if (!(erro instanceof ErroValidacao)) throw erro;
        return renderizarEnvio(req, res, {
            erros: erro.campos || { arquivo: erro.message },
            valores: req.body,
            status: erro.status || 422,
        });
    }

    const envio = await arquivoTemporario.guardar(req.arquivo);

    return res.render('admin/importacao/previa', {
        tituloPagina: 'Conferir importação',
        subtitulo: req.arquivo.nome,
        menuAtivo: 'importacao',
        breadcrumbs: trilha({ texto: 'Importar grade', url: CAMINHO }, { texto: 'Conferência' }),
        relatorio,
        arquivo: req.arquivo,
        opcoes,
        acao: `${CAMINHO}/${envio}/aplicar`,
        acaoCancelar: `${CAMINHO}/${envio}/descartar`,
    });
};

/** POST /admin/importacao/:envio/aplicar — grava de verdade. */
const aplicar = async (req, res) => {
    const opcoes = validar(schemaEnvio, req.body);
    const arquivo = await arquivoTemporario.recuperar(req.params.envio);

    const relatorio = await importacaoService.aplicar(arquivo.conteudo, {
        ...opcoes,
        arquivo: arquivo.nome,
        usuarioId: req.usuario ? req.usuario.id : null,
    });

    await arquivoTemporario.descartar(req.params.envio);

    return res.render('admin/importacao/resultado', {
        tituloPagina: 'Importação concluída',
        subtitulo: arquivo.nome,
        menuAtivo: 'importacao',
        breadcrumbs: trilha({ texto: 'Importar grade', url: CAMINHO }, { texto: 'Resultado' }),
        relatorio,
        arquivo,
    });
};

/** POST /admin/importacao/:envio/descartar — abandona o envio sem gravar. */
const descartar = async (req, res) => {
    await arquivoTemporario.descartar(req.params.envio);
    req.flash('info', 'Importação cancelada. Nada foi gravado.');
    res.redirect(res.locals.withBase(CAMINHO));
};

module.exports = { inicio, analisar, aplicar, descartar };
