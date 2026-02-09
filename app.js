require('dotenv').config();

const express = require('express');
const app = express();
const path = require('path');
const routes = require('./src/routes');
const db = require('./src/database/db'); // Importante: Conexão com banco

const normalizeBasePath = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw || raw === '/') return '';
    const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
    return prefixed.replace(/\/+$/, '');
};

const configuredBasePath = normalizeBasePath(process.env.BASE_PATH || '');

// Configurações
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

app.use((req, res, next) => {
    const headerPrefix = String(req.headers['x-forwarded-prefix'] || '')
        .split(',')[0]
        .trim();
    const basePath = configuredBasePath || normalizeBasePath(headerPrefix);

    req.basePathPrefix = basePath;
    res.locals.basePath = basePath;
    res.locals.withBase = (target = '/') => {
        const pathTarget = String(target || '/');
        const normalizedTarget = pathTarget.startsWith('/') ? pathTarget : `/${pathTarget}`;
        return `${basePath}${normalizedTarget}`;
    };

    next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- SEGURANÇA: MIDDLEWARE DE TOKEN DINÂMICO ---
app.use('/admin', async (req, res, next) => {
    const tokenUrl = req.query.token;

    // Se não tiver token, manda para a Home pública
    if (!tokenUrl) {
        return res.redirect(res.locals.withBase('/'));
    }

    try {
        // Busca o usuário dono deste token
        const result = await db.query('SELECT * FROM usuarios WHERE token_acesso = $1', [tokenUrl]);
        const usuario = result.rows[0];

        // Se o token não existir no banco, nega acesso
        if (!usuario) {
            return res.redirect(res.locals.withBase('/'));
        }

        // SALVA O USUÁRIO NA SESSÃO (para usar nos controllers e views)
        res.locals.usuarioLogado = usuario; 
        res.locals.token = tokenUrl; // Mantém o token para os links não quebrarem
        
        next();
    } catch (err) {
        console.error("Erro na autenticação:", err);
        res.redirect(res.locals.withBase('/'));
    }
});

// Rotas
app.use('/', routes);

// Iniciar Servidor
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse Público: http://localhost:${PORT}`);
    console.log(`Acesse Admin:   http://localhost:${PORT}/admin?token=SEU_TOKEN`);
});
