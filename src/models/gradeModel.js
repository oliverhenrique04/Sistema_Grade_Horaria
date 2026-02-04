// Simulação do Banco de Dados
const dados = {
    cursos: [
        { id: 1, nome: "Ciência da Computação" }
    ],
    turnos: [
        { id: "matutino", nome: "Matutino", icone: "fa-sun", tema: "matutino-theme", btnClass: "active-mat" },
        { id: "noturno", nome: "Noturno", icone: "fa-moon", tema: "noturno-theme", btnClass: "active-not" }
    ],
    turmas: [
        // --- MATUTINO ---
        {
            id: 1,
            nome: "Turmas 1º e 2º",
            semestre: "1 & 2",
            turno: "matutino",
            icone: "fa-graduation-cap",
            ocupacao: 5,
            grade: [
                { dia: "SEG", icone: "fa-diagram-project", disciplinas: [{ nome: "Lógica Computacional", prof: "Prof. Edward Lima" }] },
                { dia: "TER", icone: "fa-code-commit", disciplinas: [{ nome: "Engenharia de Software", prof: "Prof. Paulo Augusto" }] },
                { dia: "QUA", icone: "fa-sitemap", disciplinas: [{ nome: "PI Modelagem de Software", prof: "Prof. Hyago Santana" }] },
                { dia: "QUI", icone: "fa-terminal", disciplinas: [{ nome: "Algoritmos", prof: "Prof. Jorge Osvaldo" }] },
                { dia: "SEX", icone: "fa-microchip", disciplinas: [{ nome: "Org. e Arq. de Computadores", prof: "Prof. Edward Lima" }] }
            ]
        },
        {
            id: 2,
            nome: "Turma 3º",
            semestre: "3",
            turno: "matutino",
            icone: "fa-graduation-cap",
            ocupacao: 5,
            grade: [
                { dia: "SEG", icone: "fa-file-contract", disciplinas: [{ nome: "Engenharia de Requisitos", prof: "Prof. Paulo Augusto" }] },
                { dia: "TER", icone: "fa-folder-tree", disciplinas: [{ nome: "Estrutura de Dados", prof: "Prof. Jorge Osvaldo" }] },
                // Exemplo de dia dividido (Split Day)
                { 
                    dia: "QUA", icone: "fa-network-wired", aviso: true, split: true,
                    disciplinas: [
                        { nome: "Redes de Computadores", prof: "Prof. Edward Lima", note: "ADS" },
                        { nome: "Dia Livre", prof: null, note: "SI", livre: true }
                    ]
                },
                { dia: "QUI", icone: "fa-laptop-code", disciplinas: [{ nome: "PI Prog. Estruturada", prof: "Prof. Paulo Augusto" }] },
                { dia: "SEX", icone: "fa-database", disciplinas: [{ nome: "Banco de Dados I", prof: "Prof. Hyago Santana" }] }
            ]
        },
        // ... Adicione as outras turmas do seu HTML aqui seguindo este padrão
    ]
};

module.exports = {
    getAll: () => dados
};