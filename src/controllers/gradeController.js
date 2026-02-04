const gradeModel = require('../models/gradeModel');

exports.getPublicPage = (req, res) => {
    const dados = gradeModel.getAll();
    
    // Renderiza a view 'index' passando os dados
    res.render('index', { 
        turnos: dados.turnos,
        turmas: dados.turmas
    });
};

exports.getAdminDashboard = (req, res) => {
    // Aqui viria a lógica dos CRUDs
    res.send("<h1>Área Administrativa</h1><p>Aqui entrarão os CRUDs de Usuários, Cursos, etc.</p>");
};