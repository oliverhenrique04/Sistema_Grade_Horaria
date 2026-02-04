const db = require('../database/db');

exports.getGradePage = async (req, res) => {
    try {
        const { curso_id } = req.query;

        // 1. Buscar Cursos (para o select)
        const cursosRes = await db.query('SELECT * FROM cursos');
        
        // 2. Buscar Detalhes do Curso Selecionado (para pegar o Coordenador)
        let cursoDetalhes = null;
        if (curso_id) {
            const cursoQuery = await db.query('SELECT * FROM cursos WHERE id = $1', [curso_id]);
            cursoDetalhes = cursoQuery.rows[0];
        }

        // 3. Buscar Grade Completa
        let queryText = `
            SELECT 
                t.id as turma_id, t.nome as turma_nome, t.semestre_ref, 
                tu.slug as turno_slug, tu.id as turno_id,
                g.dia_semana, g.icone_dia, g.e_livre,
                d.nome as disciplina_nome,
                p.nome as prof_nome
            FROM turmas t
            JOIN turnos tu ON t.turno_id = tu.id
            LEFT JOIN grade g ON g.turma_id = t.id
            LEFT JOIN disciplinas d ON g.disciplina_id = d.id
            LEFT JOIN professores p ON g.professor_id = p.id
        `;
        
        if (curso_id) {
            queryText += ` WHERE t.curso_id = ${curso_id}`;
        }
        
        // Ordena por dia da semana para facilitar a exibição
        queryText += ` ORDER BY 
            CASE g.dia_semana 
                WHEN 'SEG' THEN 1 WHEN 'TER' THEN 2 WHEN 'QUA' THEN 3 
                WHEN 'QUI' THEN 4 WHEN 'SEX' THEN 5 
            END`;

        const gradeRes = await db.query(queryText);

        // 4. Processamento dos Dados
        const turmasMap = new Map();
        const turnosComAula = new Set(); // Para saber quais turnos ativar

        gradeRes.rows.forEach(row => {
            // Registra que este turno tem conteúdo
            turnosComAula.add(row.turno_slug);

            if (!turmasMap.has(row.turma_id)) {
                turmasMap.set(row.turma_id, {
                    id: row.turma_id,
                    nome: row.turma_nome,
                    semestre: row.semestre_ref,
                    turno: row.turno_slug,
                    dias: []
                });
            }

            if (row.dia_semana) {
                const turma = turmasMap.get(row.turma_id);
                turma.dias.push({
                    dia: row.dia_semana,
                    icone: row.icone_dia,
                    disciplina: row.disciplina_nome,
                    prof: row.prof_nome,
                    livre: row.e_livre
                });
            }
        });

        // 5. Buscar Turnos e filtrar/ordenar
        // Trazemos todos os turnos ordenados pela coluna 'ordem' (1,2,3,4)
        const todosTurnos = await db.query('SELECT * FROM turnos ORDER BY ordem ASC');
        
        // Filtramos: só mostramos o turno se ele estiver no Set 'turnosComAula'
        // OU se não tiver filtro de curso (mostra todos para não ficar vazio no início)
        const turnosFiltrados = todosTurnos.rows.filter(t => 
            turnosComAula.has(t.slug) || (!curso_id && turnosComAula.size === 0)
        );

        res.render('public/index', {
            turnos: turnosFiltrados.length > 0 ? turnosFiltrados : todosTurnos.rows, // Fallback se vazio
            cursos: cursosRes.rows,
            turmas: Array.from(turmasMap.values()),
            cursoSelecionado: curso_id,
            cursoDetalhes: cursoDetalhes // Envia dados do coordenador
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao carregar grade: " + err.message);
    }
};