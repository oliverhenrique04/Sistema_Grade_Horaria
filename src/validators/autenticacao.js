/**
 * Validacao dos dados do formulario de login.
 */
const { z } = require('zod');
const { ErroValidacao } = require('../utils/erros');

const esquemaLogin = z.object({
    email: z
        .string({ error: 'Informe o e-mail.' })
        .trim()
        .toLowerCase()
        .min(1, { error: 'Informe o e-mail.' })
        .max(150, { error: 'E-mail muito longo.' })
        .pipe(z.email({ error: 'Informe um e-mail válido.' })),
    senha: z
        .string({ error: 'Informe a senha.' })
        .min(1, { error: 'Informe a senha.' })
        // Limite alto o bastante para qualquer senha real e baixo o bastante
        // para evitar consumo desnecessario de CPU no bcrypt.
        .max(200, { error: 'Senha muito longa.' }),
});

/**
 * Converte os issues do zod em um mapa campo -> mensagem.
 * @param {import('zod').ZodError} erro
 * @returns {Record<string, string>}
 */
const mapearCampos = (erro) => {
    const campos = {};
    erro.issues.forEach((problema) => {
        const campo = problema.path[0];
        if (campo && !campos[campo]) campos[campo] = problema.message;
    });
    return campos;
};

/**
 * Valida e normaliza os dados do login (e-mail em minusculas e sem espacos).
 * @param {Record<string, unknown>} dados
 * @returns {{email:string, senha:string}}
 * @throws {ErroValidacao}
 */
const validarLogin = (dados = {}) => {
    const resultado = esquemaLogin.safeParse({
        email: dados.email,
        senha: dados.senha,
    });

    if (!resultado.success) {
        throw new ErroValidacao('Informe e-mail e senha válidos.', mapearCampos(resultado.error));
    }

    return resultado.data;
};

module.exports = { esquemaLogin, validarLogin };
