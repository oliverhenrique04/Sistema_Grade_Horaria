/**
 * Sessao de usuario persistida no PostgreSQL (tabela `session`, criada pela
 * migration 001). O cookie guarda apenas o identificador assinado da sessao;
 * nenhum dado do usuario trafega no navegador.
 *
 * Ordem recomendada no app:
 *   aplicarSeguranca(app)  -> helmet + parsers de body
 *   criarMiddlewareSessao()
 *   csrf.gerarToken
 *   autenticacao.carregarUsuario
 *   rotas
 */
const session = require('express-session');
const conectarPgSimple = require('connect-pg-simple');
const config = require('../config/env');
const db = require('../config/db');

/**
 * Cria o middleware de sessao ja configurado com o store do PostgreSQL.
 * @returns {import('express').RequestHandler}
 */
const criarMiddlewareSessao = () => {
    const ArmazenamentoPg = conectarPgSimple(session);

    const opcoesStore = {
        // Reaproveita o pool da aplicacao: nao abre conexoes adicionais.
        pool: db.pool,
        tableName: 'session',
        // A tabela e criada pela migration 001; o store nao deve alterar o schema.
        createTableIfMissing: false,
        // Limpeza periodica das sessoes expiradas.
        pruneSessionInterval: 60 * 15,
    };

    if (config.banco.schema && config.banco.schema !== 'public') {
        opcoesStore.schemaName = config.banco.schema;
    }

    return session({
        store: new ArmazenamentoPg(opcoesStore),
        name: config.sessao.nomeCookie,
        secret: config.sessao.segredo,
        resave: false,
        saveUninitialized: false,
        // Renova o vencimento do cookie a cada requisicao (inatividade encerra a sessao).
        rolling: true,
        // A aplicacao roda atras de proxy reverso (nginx); necessario para o
        // express-session identificar corretamente conexoes https.
        proxy: true,
        cookie: {
            httpOnly: true,
            secure: config.sessao.cookieSeguro,
            sameSite: config.sessao.sameSite,
            maxAge: config.sessao.ttlMinutos * 60 * 1000,
            // O path precisa ser '/' mesmo quando BASE_PATH esta definido.
            // O proxy reverso remove o prefixo antes de repassar (proxy_pass com
            // barra final), entao a aplicacao ve "/login" enquanto o navegador ve
            // "/grades/login". O express-session compara o path do cookie com
            // req.originalUrl e ignora a sessao inteira quando eles divergem
            // (pathname mismatch), o que tornaria o login impossivel.
            path: '/',
        },
    });
};

module.exports = { criarMiddlewareSessao };
