const express = require('express');
const app = express();
const path = require('path');
const routes = require('./src/routes');
const db = require('./src/database/db'); // Importante: Conexão com banco

// Configurações
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- SEGURANÇA: MIDDLEWARE DE TOKEN DINÂMICO ---
app.use('/admin', async (req, res, next) => {
    const tokenUrl = req.query.token;

    // Se não tiver token, manda para a Home pública
    if (!tokenUrl) {
        return res.redirect('/'); 
    }

    try {
        // Busca o usuário dono deste token
        const result = await db.query('SELECT * FROM usuarios WHERE token_acesso = $1', [tokenUrl]);
        const usuario = result.rows[0];

        // Se o token não existir no banco, nega acesso
        if (!usuario) {
            return res.redirect('/');
        }

        // SALVA O USUÁRIO NA SESSÃO (para usar nos controllers e views)
        res.locals.usuarioLogado = usuario; 
        res.locals.token = tokenUrl; // Mantém o token para os links não quebrarem
        
        next();
    } catch (err) {
        console.error("Erro na autenticação:", err);
        res.redirect('/');
    }
});

// Rotas
app.use('/', routes);

// Iniciar Servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse Público: http://localhost:${PORT}`);
    console.log(`Acesse Admin:   http://localhost:${PORT}/admin?token=master123`);
});