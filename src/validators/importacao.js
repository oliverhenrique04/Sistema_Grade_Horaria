/**
 * Validacao do formulario de importacao de grade.
 *
 * Como nos demais validadores do projeto, o schema lista campo a campo o que
 * pode chegar ao servico: nada mais do corpo da requisicao sobrevive.
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

const paraNulo = (valor) => {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    return valor;
};

/** Caixa marcada em formulario HTML chega como "on"/"1"/"true"; ausente e falso. */
const marcado = z.preprocess((valor) => {
    if (valor === undefined || valor === null || valor === '') return false;
    if (typeof valor === 'boolean') return valor;
    return ['1', 'on', 'true', 'sim'].includes(String(valor).trim().toLowerCase());
}, z.boolean());

/**
 * Opcoes escolhidas no envio da planilha.
 *
 * `periodoLetivoId` vazio significa "usar o periodo detectado nas datas da
 * planilha, criando-o se ainda nao existir".
 */
const schemaEnvio = z.object({
    periodoLetivoId: z
        .preprocess(
            paraNulo,
            z.coerce
                .number({ error: 'Período letivo inválido.' })
                .int({ error: 'Período letivo inválido.' })
                .positive({ error: 'Período letivo inválido.' })
                .nullable()
        )
        .catch(null),
    inativarAusentes: marcado,
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
 * @returns {T}
 * @throws {ErroValidacao}
 */
const validar = (schema, dados = {}, mensagem = 'Verifique os campos destacados.') => {
    const resultado = schema.safeParse(dados || {});
    if (!resultado.success) {
        throw new ErroValidacao(mensagem, mapearCampos(resultado.error));
    }
    return resultado.data;
};

module.exports = { schemaEnvio, validar };
