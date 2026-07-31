/**
 * Validacao dos dados de usuario (formularios HTML e filtros de listagem).
 *
 * Decisoes de seguranca:
 *  - a senha e validada aqui, mas NUNCA e devolvida para as views nem
 *    registrada em log; o servico converte imediatamente em hash bcrypt;
 *  - `perfil`, `ativo` e os vinculos de escopo (`cursosIds`, `campusIds`) sao
 *    campos declarados explicitamente. Como o schema descarta qualquer chave
 *    desconhecida, um corpo manipulado nao consegue gravar colunas extras
 *    (protecao contra mass assignment). Quem pode enviar esses campos e
 *    decidido nas rotas (`exigirPerfil('admin')`), nunca pelo payload.
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');
const { PERFIS } = require('../utils/formatadores');

const VALORES_PERFIL = PERFIS.map((item) => item.valor);

/** Tamanho minimo exigido para qualquer senha cadastrada pelo painel. */
const SENHA_MINIMA = 8;
/** Teto apenas para nao gastar CPU do bcrypt com entradas absurdas. */
const SENHA_MAXIMA = 200;

const paraNulo = (valor) => {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    return valor;
};

const paraIndefinido = (valor) => {
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor === 'string' && valor.trim() === '') return undefined;
    return valor;
};

/**
 * Normaliza a lista de ids vinda de checkboxes:
 * ausente -> [], valor unico -> [valor], multiplos -> array.
 */
const paraListaDeIds = (valor) => {
    if (valor === undefined || valor === null || valor === '') return [];
    const lista = Array.isArray(valor) ? valor : [valor];
    return lista.filter(
        (item) => item !== undefined && item !== null && String(item).trim() !== ''
    );
};

const listaDeIds = (mensagem) =>
    z.preprocess(
        paraListaDeIds,
        z.array(
            z.coerce
                .number({ error: mensagem })
                .int({ error: mensagem })
                .positive({ error: mensagem }),
            { error: mensagem }
        )
    );

const interpretarBooleano = (valor, padrao) => {
    if (valor === undefined || valor === null || valor === '') return padrao;
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor).trim().toLowerCase();
    if (['1', 'true', 'sim', 'ativo', 'ativos'].includes(texto)) return true;
    if (['0', 'false', 'nao', 'não', 'inativo', 'inativos'].includes(texto)) return false;
    return padrao;
};

const nome = z.preprocess(
    paraIndefinido,
    z
        .string({ error: 'Informe o nome do usuário.' })
        .trim()
        .min(1, { error: 'Informe o nome do usuário.' })
        .max(120, { error: 'O nome deve ter no máximo 120 caracteres.' })
);

const email = z.preprocess(
    paraIndefinido,
    z
        .string({ error: 'Informe o e-mail.' })
        .trim()
        .toLowerCase()
        .min(1, { error: 'Informe o e-mail.' })
        .max(150, { error: 'O e-mail deve ter no máximo 150 caracteres.' })
        .pipe(z.email({ error: 'Informe um e-mail válido.' }))
);

const perfil = z.preprocess(
    paraIndefinido,
    z.enum(VALORES_PERFIL, { error: 'Selecione um perfil válido.' })
);

const ativo = z.preprocess((valor) => interpretarBooleano(valor, true), z.boolean());

const senhaObrigatoria = z.preprocess(
    paraIndefinido,
    z
        .string({ error: 'Informe a senha.' })
        .min(SENHA_MINIMA, { error: `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.` })
        .max(SENHA_MAXIMA, { error: 'Senha muito longa.' })
);

/** Na edicao, senha em branco significa "manter a senha atual". */
const senhaOpcional = z.preprocess(
    paraNulo,
    z
        .string({ error: 'Senha inválida.' })
        .min(SENHA_MINIMA, { error: `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.` })
        .max(SENHA_MAXIMA, { error: 'Senha muito longa.' })
        .nullable()
);

const cursosIds = listaDeIds('Selecione cursos válidos.');
const campusIds = listaDeIds('Selecione campus válidos.');

const schemaCriacao = z.object({
    nome,
    email,
    senha: senhaObrigatoria,
    perfil,
    ativo,
    cursosIds,
    campusIds,
});

const schemaEdicao = z.object({
    nome,
    email,
    senha: senhaOpcional,
    perfil,
    ativo,
    cursosIds,
    campusIds,
});

/** Redefinicao de senha isolada, disparada pelo formulario de edicao. */
const schemaSenha = z
    .object({
        senha: senhaObrigatoria,
        confirmacao: z.preprocess(paraNulo, z.string().nullable()),
    })
    .refine((dados) => !dados.confirmacao || dados.confirmacao === dados.senha, {
        error: 'A confirmação não confere com a nova senha.',
        path: ['confirmacao'],
    });

const schemaStatus = z.object({
    ativo: z.preprocess(
        (valor) => interpretarBooleano(valor, null),
        z.boolean({ error: 'Informe a nova situação do usuário.' })
    ),
});

/** Filtros da listagem: tolerantes, um parametro invalido vira `null`. */
const schemaFiltros = z.object({
    busca: z.preprocess(paraNulo, z.string().trim().max(120).nullable()).catch(null),
    perfil: z.preprocess(paraNulo, z.enum(VALORES_PERFIL).nullable()).catch(null),
    ativo: z
        .preprocess((valor) => interpretarBooleano(valor, null), z.boolean().nullable())
        .catch(null),
});

/**
 * Converte os issues do zod em um mapa campo -> mensagem (primeira ocorrencia).
 * @param {import('zod').ZodError} erro
 * @returns {Record<string, string>}
 */
const mapearCampos = (erro) => {
    const campos = {};
    erro.issues.forEach((problema) => {
        const campo = problema.path.length > 0 ? String(problema.path[0]) : 'geral';
        if (!campos[campo]) campos[campo] = problema.message;
    });
    return campos;
};

/**
 * Valida `dados` contra `schema`.
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {Record<string, unknown>} dados
 * @param {string} [mensagem]
 * @returns {T} dados normalizados (somente os campos do schema)
 * @throws {ErroValidacao}
 */
const validar = (schema, dados = {}, mensagem = 'Verifique os campos destacados.') => {
    const resultado = schema.safeParse(dados || {});
    if (!resultado.success) {
        throw new ErroValidacao(mensagem, mapearCampos(resultado.error));
    }
    return resultado.data;
};

module.exports = {
    schemaCriacao,
    schemaEdicao,
    schemaSenha,
    schemaStatus,
    schemaFiltros,
    validar,
    PERFIS,
    VALORES_PERFIL,
    SENHA_MINIMA,
};
