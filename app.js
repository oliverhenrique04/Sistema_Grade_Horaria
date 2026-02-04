const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const routes = require('./src/routes');

const app = express();

// Configurações da View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// Arquivos Estáticos (CSS, Imagens)
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));

// Usar Rotas
app.use('/', routes);

// Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});