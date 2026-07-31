/**
 * Definicao unica do menu lateral do painel. Cada item declara o recurso
 * correspondente na matriz de permissoes; o middleware de menu filtra os itens
 * que o usuario nao pode sequer ler.
 *
 * A visibilidade aqui e apenas conveniencia de interface: toda rota tambem
 * verifica permissao no backend.
 */
const GRUPOS = [
    {
        titulo: 'Grade horária',
        itens: [
            {
                chave: 'dashboard',
                rotulo: 'Painel',
                icone: 'fa-gauge-high',
                url: '/admin',
                recurso: 'dashboard',
            },
            {
                chave: 'turmas',
                rotulo: 'Turmas',
                icone: 'fa-users-rectangle',
                url: '/admin/turmas',
                recurso: 'turmas',
            },
            {
                chave: 'aulas',
                rotulo: 'Aulas',
                icone: 'fa-calendar-days',
                url: '/admin/aulas',
                recurso: 'aulas',
            },
        ],
    },
    {
        titulo: 'Cadastros acadêmicos',
        itens: [
            {
                chave: 'cursos',
                rotulo: 'Cursos',
                icone: 'fa-graduation-cap',
                url: '/admin/cursos',
                recurso: 'cursos',
            },
            {
                chave: 'disciplinas',
                rotulo: 'Disciplinas',
                icone: 'fa-book',
                url: '/admin/disciplinas',
                recurso: 'disciplinas',
            },
            {
                chave: 'professores',
                rotulo: 'Professores',
                icone: 'fa-chalkboard-user',
                url: '/admin/professores',
                recurso: 'professores',
            },
            {
                chave: 'periodos',
                rotulo: 'Períodos letivos',
                icone: 'fa-calendar-check',
                url: '/admin/periodos',
                recurso: 'periodos',
            },
        ],
    },
    {
        titulo: 'Estrutura',
        itens: [
            {
                chave: 'campus',
                rotulo: 'Campus',
                icone: 'fa-building-columns',
                url: '/admin/campus',
                recurso: 'campus',
            },
            {
                chave: 'locais',
                rotulo: 'Locais',
                icone: 'fa-door-open',
                url: '/admin/locais',
                recurso: 'locais',
            },
            {
                chave: 'turnos',
                rotulo: 'Turnos',
                icone: 'fa-clock',
                url: '/admin/turnos',
                recurso: 'turnos',
            },
            {
                chave: 'horarios',
                rotulo: 'Horários dos turnos',
                icone: 'fa-hourglass-half',
                url: '/admin/horarios',
                recurso: 'horarios',
            },
        ],
    },
    {
        titulo: 'Administração',
        itens: [
            {
                chave: 'usuarios',
                rotulo: 'Usuários',
                icone: 'fa-user-gear',
                url: '/admin/usuarios',
                recurso: 'usuarios',
            },
            {
                chave: 'importacao',
                rotulo: 'Importar grade',
                icone: 'fa-file-import',
                url: '/admin/importacao',
                recurso: 'importacao',
            },
        ],
    },
];

module.exports = { GRUPOS };
