/**
 * Helpers de aplicacao/HTTP para os testes.
 *
 * Uso tipico:
 *
 *     const request = require('supertest');
 *     const { criarApp, criarAgente, login, postComCsrf } = require('./helpers/app');
 *
 *     const app = criarApp();
 *     const agente = criarAgente(app);
 *     await login(agente, usuario.email, usuario.senha);
 *     const resposta = await postComCsrf(agente, '/admin/turmas', { nome: 'A' });
 *
 * Todo POST/PUT/PATCH/DELETE precisa do token CSRF: use `postComCsrf` (ou
 * `tokenCsrf` + envio manual do campo `_csrf`).
 */
const request = require('supertest');
const config = require('../../src/config/env');
const db = require('../../src/config/db');

/**
 * Cria a instancia do Express usada pelos testes, sempre pela fabrica oficial.
 *
 * Se `src/app.js` nao carregar (rota quebrada, modulo ausente), a falha deve
 * ser ruidosa: um app substituto responderia 200 e mascararia o defeito real
 * em todas as suites.
 *
 * @returns {import('express').Express}
 */
const criarApp = () => {
    const { criarApp: fabrica } = require('../../src/app');
    return fabrica();
};

/**
 * Agente do supertest que preserva cookies entre requisicoes.
 * @param {import('express').Express} app
 * @returns {import('supertest').SuperAgentTest}
 */
const criarAgente = (app) => request.agent(app);

/** sid da sessao conhecido para cada agente (preenchido a cada resposta). */
const sessoesPorAgente = new WeakMap();

/**
 * Le o cookie de sessao da resposta e memoriza o sid correspondente.
 * @param {object} agente
 * @param {import('supertest').Response} resposta
 */
const registrarSessao = (agente, resposta) => {
    const cabecalho = resposta.headers['set-cookie'];
    if (!Array.isArray(cabecalho)) return;

    const cookie = cabecalho.find((linha) => linha.startsWith(`${config.sessao.nomeCookie}=`));
    if (!cookie) return;

    const valor = decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
    if (!valor) {
        sessoesPorAgente.delete(agente);
        return;
    }

    // express-session grava o cookie assinado no formato "s:<sid>.<assinatura>".
    const sid = valor.startsWith('s:') ? valor.slice(2).split('.')[0] : valor;
    sessoesPorAgente.set(agente, sid);
};

/**
 * Extrai o valor do campo oculto `_csrf` de uma pagina HTML.
 * @param {string} html
 * @returns {string} token ou string vazia
 */
const extrairCsrfDoHtml = (html = '') => {
    const entrada = /<input[^>]*name=["']_csrf["'][^>]*>/i.exec(html);
    if (!entrada) return '';
    const valor = /value=["']([^"']*)["']/i.exec(entrada[0]);
    return valor ? valor[1] : '';
};

/**
 * Obtem o token CSRF valido para o agente.
 *
 * Antes do login, le a propria tela `/login`. Depois do login (quando `/login`
 * passa a redirecionar), le o token direto da sessao gravada no banco.
 *
 * @param {object} agente agente do supertest
 * @param {string} [caminho='/login'] pagina de onde extrair o token, se necessario
 * @returns {Promise<string>}
 */
const tokenCsrf = async (agente, caminho = '/login') => {
    const sid = sessoesPorAgente.get(agente);

    if (sid) {
        const resultado = await db.query('SELECT sess FROM session WHERE sid = $1', [sid]);
        if (resultado.rowCount > 0) {
            const sessao =
                typeof resultado.rows[0].sess === 'string'
                    ? JSON.parse(resultado.rows[0].sess)
                    : resultado.rows[0].sess;
            if (sessao && sessao.csrfToken) return sessao.csrfToken;
        }
    }

    const pagina = await agente.get(caminho);
    registrarSessao(agente, pagina);
    return extrairCsrfDoHtml(pagina.text);
};

/**
 * Envia um POST em formato de formulario ja com o token CSRF.
 * @param {object} agente
 * @param {string} caminho
 * @param {Record<string, any>} [dados]
 * @returns {Promise<import('supertest').Response>}
 */
const postComCsrf = async (agente, caminho, dados = {}) => {
    const token = await tokenCsrf(agente);
    const resposta = await agente
        .post(caminho)
        .type('form')
        .send({ ...dados, _csrf: token });
    registrarSessao(agente, resposta);
    return resposta;
};

/**
 * Executa o fluxo de login (busca o token CSRF e envia o formulario) sem exigir
 * sucesso. Util para testar credenciais invalidas.
 * @param {object} agente
 * @param {string} email
 * @param {string} senha
 * @param {{proximo?:string}} [opcoes]
 * @returns {Promise<import('supertest').Response>}
 */
const tentarLogin = async (agente, email, senha, { proximo } = {}) => {
    const token = await tokenCsrf(agente, '/login');
    const corpo = { email, senha, _csrf: token };
    if (proximo !== undefined) corpo.proximo = proximo;

    const resposta = await agente.post('/login').type('form').send(corpo);
    registrarSessao(agente, resposta);
    return resposta;
};

/**
 * Faz o login completo e devolve o agente autenticado.
 * @param {object} agente agente criado por `criarAgente(app)`
 * @param {string} email
 * @param {string} senha
 * @returns {Promise<object>} o proprio agente, ja com a sessao ativa
 * @throws {Error} quando as credenciais sao recusadas
 */
const login = async (agente, email, senha) => {
    const resposta = await tentarLogin(agente, email, senha);

    if (resposta.status !== 302) {
        throw new Error(
            `Falha no login de ${email}: status ${resposta.status} (esperado redirecionamento).`
        );
    }

    return agente;
};

module.exports = {
    criarApp,
    criarAgente,
    login,
    tentarLogin,
    tokenCsrf,
    postComCsrf,
    extrairCsrfDoHtml,
    registrarSessao,
};
