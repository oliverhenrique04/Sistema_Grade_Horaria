/**
 * Gerador de links das TVs dos blocos (/admin/paineis).
 *
 * Escolhe-se campus, cursos, turmas e locais, e sai o endereco que fica fixo no
 * navegador daquela TV. O link nao guarda turno nem dia: isso o relogio do
 * servidor resolve sozinho, todo dia, sem ninguem tocar na TV.
 *
 * A tela e so leitura e so GET — nao grava nada e por isso nao carrega token
 * CSRF. Um painel novo custa um link novo, nao um registro no banco.
 */
const servico = require('../../services/painelService');
const validador = require('../../validators/painel');
const { podeAcessarCampus } = require('../../middlewares/autorizacao');
const { urlAbsoluta } = require('../../utils/urls');
const { async: assincrono } = require('../../utils/erros');

const MENU = 'paineis';

/**
 * Query string do painel a partir do recorte escolhido.
 *
 * As listas saem separadas por virgula, e nao repetidas: `locais=26,27,28` cabe
 * numa etiqueta colada atras da TV e gera um QR menos denso do que
 * `locais=26&locais=27&locais=28`.
 *
 * @param {object} recorte
 * @returns {string}
 */
const consultaDoPainel = (recorte = {}) => {
    const parametros = new URLSearchParams();

    if (recorte.campusId) parametros.set('campus', String(recorte.campusId));
    if (recorte.cursosIds) parametros.set('cursos', recorte.cursosIds.join(','));
    if (recorte.turmasIds) parametros.set('turmas', recorte.turmasIds.join(','));
    if (recorte.locaisIds) parametros.set('locais', recorte.locaisIds.join(','));
    if (recorte.titulo) parametros.set('titulo', recorte.titulo);

    const consulta = parametros.toString();
    return consulta ? `/painel?${consulta}` : '/painel';
};

/**
 * Endereco absoluto, que e o que se cola no navegador da TV.
 *
 * Sai do esquema e do host pelos quais o operador abriu o painel
 * administrativo — e nao de `URL_PUBLICA`, que serve ao QR. Sao enderecos
 * diferentes de proposito: a TV pode alcancar o servidor por http num endereco
 * interno, enquanto o celular do aluno precisa do endereco publico. O campo do
 * formulario e editavel para o operador trocar o host quando a TV usa outro.
 */
const enderecoCompleto = (req, caminho) => urlAbsoluta(req, caminho);

/** GET /admin/paineis — monta o link e mostra o recorte escolhido. */
const gerador = assincrono(async (req, res) => {
    const recorte = validador.validarRecorte(req.query);

    const opcoes = await servico.opcoesDoGerador({ campusId: recorte.campusId }, (campusId) =>
        podeAcessarCampus(req.usuario, campusId)
    );

    // Campus fora do escopo do usuario nao vira recorte: o gerador volta a
    // pedir a escolha em vez de montar um link que ele nao deveria listar.
    const campusValido = Boolean(opcoes.campusEscolhido);
    const recorteFinal = campusValido ? recorte : { titulo: recorte.titulo };

    const caminho = consultaDoPainel(recorteFinal);

    res.render('admin/paineis/gerador', {
        tituloPagina: 'TVs dos blocos',
        menuAtivo: MENU,
        breadcrumbs: [{ rotulo: 'TVs dos blocos' }],
        opcoes,
        recorte: recorteFinal,
        // Conjuntos para a view marcar as caixas sem procurar em array a cada item.
        marcados: {
            cursos: new Set(recorteFinal.cursosIds || []),
            turmas: new Set(recorteFinal.turmasIds || []),
            locais: new Set(recorteFinal.locaisIds || []),
        },
        temRecorte: campusValido,
        caminhoPainel: req.withBase(caminho),
        enderecoPainel: enderecoCompleto(req, caminho),
        limiteLista: validador.MAXIMO_POR_LISTA,
        limiteTitulo: validador.TITULO_MAXIMO,
    });
});

module.exports = { gerador, consultaDoPainel };
