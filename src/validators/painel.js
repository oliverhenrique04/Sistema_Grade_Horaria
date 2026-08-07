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

module.exports = { validarRecorte, esquema, MAXIMO_POR_LISTA, TITULO_MAXIMO };
