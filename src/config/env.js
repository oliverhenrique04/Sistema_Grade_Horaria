const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const raizProjeto = path.resolve(__dirname, '..', '..');
const ambiente = process.env.NODE_ENV || 'production';

// Carrega .env.<ambiente> primeiro (tem prioridade) e depois o .env base.
// dotenv nao sobrescreve variaveis ja definidas, entao a ordem define a precedencia.
[`.env.${ambiente}`, '.env'].forEach((arquivo) => {
    const caminho = path.join(raizProjeto, arquivo);
    if (fs.existsSync(caminho)) {
        dotenv.config({ path: caminho, quiet: true });
    }
});

const texto = (valor, padrao = '') => {
    const bruto = typeof valor === 'string' ? valor.trim() : '';
    return bruto || padrao;
};

const inteiro = (valor, padrao) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : padrao;
};

const booleano = (valor, padrao = false) => {
    if (valor === undefined || valor === null || valor === '') return padrao;
    return String(valor).trim().toLowerCase() === 'true';
};

const normalizarBasePath = (valor = '') => {
    const bruto = String(valor || '').trim();
    if (!bruto || bruto === '/') return '';
    const comBarra = bruto.startsWith('/') ? bruto : `/${bruto}`;
    return comBarra.replace(/\/+$/, '');
};

const producao = ambiente === 'production';

if (!process.env.DATABASE_URL) {
    throw new Error('Variavel de ambiente DATABASE_URL nao definida.');
}

const segredoSessao = texto(process.env.SESSION_SECRET);

if (!segredoSessao && producao) {
    throw new Error('Variavel de ambiente SESSION_SECRET obrigatoria em producao.');
}

const config = {
    ambiente,
    producao,
    teste: ambiente === 'test',
    porta: inteiro(process.env.PORT, 3000),
    basePath: normalizarBasePath(process.env.BASE_PATH),
    banco: {
        url: process.env.DATABASE_URL,
        ssl: booleano(process.env.DB_SSL, false),
        schema: texto(process.env.DB_SCHEMA, 'public'),
    },
    sessao: {
        segredo: segredoSessao || 'segredo-de-desenvolvimento-nao-usar-em-producao',
        nomeCookie: 'grade.sid',
        ttlMinutos: inteiro(process.env.SESSION_TTL_MINUTOS, 480),
        cookieSeguro: booleano(process.env.COOKIE_SECURE, producao),
        sameSite: texto(process.env.COOKIE_SAMESITE, 'lax'),
    },
    login: {
        limite: inteiro(process.env.LOGIN_RATE_LIMIT, 10),
        janelaMinutos: inteiro(process.env.LOGIN_RATE_JANELA_MINUTOS, 15),
    },
    admin: {
        nome: texto(process.env.ADMIN_NOME, 'Administrador'),
        email: texto(process.env.ADMIN_EMAIL, 'admin@exemplo.edu.br').toLowerCase(),
        senha: texto(process.env.ADMIN_SENHA),
    },
    limitePayload: '200kb',
    // Envio de planilha na importacao de grade. Vale so para o formulario de
    // importacao; todas as demais rotas seguem com `limitePayload`.
    limiteUpload: inteiro(process.env.LIMITE_UPLOAD_MB, 25) * 1024 * 1024,
};

module.exports = config;
