/**
 * Saneamento da query string do painel de corredor.
 *
 * Mesma regra da area publica: entrada invalida NUNCA vira erro. Cada
 * parametro que nao passa simplesmente desaparece, e a pagina responde 200 com
 * o recorte mais amplo. Uma TV fica anos no ar com a URL colada atras dela —
 * um link digitado errado precisa degradar, nunca mostrar tela de erro.
 */
const { z } = require('zod');

/** Maior valor aceito por uma coluna INT do PostgreSQL. */
const MAX_INT = 2147483647;

/**
 * Teto de ids por lista. Um bloco tem dezenas de salas, nao centenas; o limite
 * evita que uma URL forjada monte um array gigante para o banco.
 */
const MAXIMO_POR_LISTA = 80;

/** Tamanho maximo do titulo exibido na TV. */
const TITULO_MAXIMO = 32;

const idOpcional = z
    .string()
    .trim()
    .regex(/^\d{1,10}$/)
    .transform((valor) => Number(valor))
    .refine((numero) => numero >= 1 && numero <= MAX_INT)
    .optional()
    .catch(undefined);

/**
 * Lista de ids, aceita nos dois formatos que a aplicacao produz:
 * `locais=26,27,28` (a URL curta que o gerador imprime e vai colada atras da
 * TV) e `locais=26&locais=27` (o que um formulario de caixas de selecao envia).
 *
 * Itens invalidos sao descartados um a um: `26,abc,28` vira `[26, 28]`, e nao
 * erro. Um id quebrado nao pode derrubar a tela inteira.
 */
const listaDeIds = z
    .union([z.string(), z.array(z.string())])
    .transform((valor) =>
        (Array.isArray(valor) ? valor : [valor])
            .flatMap((parte) => String(parte).split(','))
            .map((parte) => parte.trim())
            .filter((parte) => /^\d{1,10}$/.test(parte))
            .map(Number)
            .filter((numero) => numero >= 1 && numero <= MAX_INT)
            .slice(0, MAXIMO_POR_LISTA)
    )
    .transform((ids) => [...new Set(ids)])
    .optional()
    .catch(undefined);

/**
 * Titulo exibido no topo da TV.
 *
 * O texto vem da URL e e renderizado em corpo grande sob a marca da
 * instituicao, entao o formato e restrito de proposito: letras, digitos,
 * espaco, hifen e ponto, ate 32 caracteres. Isso preserva "Bloco C" e
 * "Bloco B - Asa Sul" e impede que o link vire cartaz. O escape do EJS cuida
 * do resto.
 */
const tituloOpcional = z
    .string()
    .trim()
    .regex(new RegExp(`^[\\p{L}\\p{N} .\\-]{1,${TITULO_MAXIMO}}$`, 'u'))
    .optional()
    .catch(undefined);

const esquema = z
    .object({
        campus: idOpcional,
        cursos: listaDeIds,
        turmas: listaDeIds,
        locais: listaDeIds,
        titulo: tituloOpcional,
    })
    .catch({});

/** Lista vazia nao e recorte: vira `undefined` para o SQL nao filtrar por nada. */
const listaUtil = (valores) => (Array.isArray(valores) && valores.length > 0 ? valores : undefined);

/**
 * Valida e normaliza o recorte de um painel.
 *
 * O periodo letivo NAO e aceito na URL de proposito: uma TV ficaria presa a
 * 2026.2 para sempre. Ele vem sempre de `periodos_letivos.atual`.
 *
 * @param {Record<string, unknown>} [query]
 * @returns {{campusId?:number, cursosIds?:number[], turmasIds?:number[],
 *            locaisIds?:number[], titulo?:string}}
 */
const validarRecorte = (query = {}) => {
    const resultado = esquema.safeParse(query || {});
    const dados = resultado.success ? resultado.data : {};

    return {
        campusId: dados.campus,
        cursosIds: listaUtil(dados.cursos),
        turmasIds: listaUtil(dados.turmas),
        locaisIds: listaUtil(dados.locais),
        titulo: dados.titulo,
    };
};

// ---------------------------------------------------------------------------
// Painel salvo (formulario do painel administrativo)
// ---------------------------------------------------------------------------

/** Slug do painel: e o que aparece na URL da TV (`/painel/bloco-c`). */
const SLUG_MAXIMO = 60;

/**
 * Transforma um titulo em slug: "Bloco B - Asa Sul" -> "bloco-b-asa-sul".
 * @param {string} valor
 * @returns {string}
 */
const paraSlug = (valor = '') =>
    String(valor || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_MAXIMO);

/** Lista de ids vinda de caixas de selecao (repetidas ou separadas por virgula). */
const listaDeIdsDoCorpo = (valor) => {
    if (valor === undefined || valor === null) return [];
    return [
        ...new Set(
            (Array.isArray(valor) ? valor : [valor])
                .flatMap((parte) => String(parte).split(','))
                .map((parte) => parte.trim())
                .filter((parte) => /^\d{1,10}$/.test(parte))
                .map(Number)
                .filter((numero) => numero >= 1 && numero <= MAX_INT)
        ),
    ].slice(0, MAXIMO_POR_LISTA);
};

/** Ultimo valor enviado para um nome de campo (o parser devolve array). */
const ultimoValor = (valor, padrao) => {
    if (valor === undefined || valor === null) return padrao;
    const lista = Array.isArray(valor) ? valor : [valor];
    return String(lista[lista.length - 1]);
};

/** Letras de bloco, como aparecem no fim do nome da sala ("101 C" -> "C"). */
const listaDeBlocos = (valor) => {
    if (valor === undefined || valor === null) return [];
    return [
        ...new Set(
            (Array.isArray(valor) ? valor : [valor])
                .flatMap((parte) => String(parte).split(','))
                .map((parte) => parte.trim().toUpperCase())
                .filter((parte) => /^[A-Z]$/.test(parte))
        ),
    ];
};

/**
 * Valida o formulario de um painel salvo.
 *
 * Diferente da query string publica, aqui entrada invalida VIRA ERRO: quem
 * preenche e um operador autenticado, na frente do formulario, e devolver a
 * tela com o campo marcado ensina mais do que salvar um recorte pela metade.
 *
 * @param {Record<string, unknown>} corpo
 * @returns {{dados:object, erros:Record<string,string>}}
 */
const validarPainelSalvo = (corpo = {}) => {
    const erros = {};
    const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

    const titulo = texto(corpo.titulo);
    if (!titulo) erros.titulo = 'Informe o nome que aparece na TV.';
    else if (titulo.length > TITULO_MAXIMO) {
        erros.titulo = `Use no máximo ${TITULO_MAXIMO} caracteres.`;
    }

    const campusId = /^\d{1,10}$/.test(texto(corpo.campus_id)) ? Number(corpo.campus_id) : null;
    if (!campusId) erros.campus_id = 'Escolha o campus.';

    // Sem slug informado, deriva do titulo — o operador nao precisa saber o que
    // e um slug para publicar uma TV.
    const slug = paraSlug(texto(corpo.slug) || titulo);
    if (!slug) erros.slug = 'Não foi possível gerar o endereço a partir do nome.';

    const dias = listaDeIdsDoCorpo(corpo.dias).filter((dia) => dia >= 1 && dia <= 6);

    return {
        erros,
        dados: {
            slug,
            titulo,
            campus_id: campusId,
            blocos: listaDeBlocos(corpo.blocos),
            locais_ids: listaDeIdsDoCorpo(corpo.locais),
            cursos_ids: listaDeIdsDoCorpo(corpo.cursos),
            turmas_ids: listaDeIdsDoCorpo(corpo.turmas),
            turnos_ids: listaDeIdsDoCorpo(corpo.turnos),
            dias,
            // Caixa de selecao com campo oculto antes: o navegador manda os dois
            // quando marcada, e so o oculto quando nao. Vale sempre o ULTIMO.
            incluir_sem_local: ultimoValor(corpo.incluir_sem_local, '1') !== '0',
            ativo: ultimoValor(corpo.ativo, '1') !== '0',
        },
    };
};

module.exports = {
    validarRecorte,
    validarPainelSalvo,
    paraSlug,
    esquema,
    MAXIMO_POR_LISTA,
    TITULO_MAXIMO,
    SLUG_MAXIMO,
};
