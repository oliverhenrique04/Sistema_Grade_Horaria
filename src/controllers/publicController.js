const db = require('../database/db');

exports.getGradePage = async (req, res) => {
    try {
        const { curso_id, unidade } = req.query; // Recebe também a unidade

        // 1. Buscar Cursos (para o select)
        const cursosRes = await db.query('SELECT * FROM cursos ORDER BY nome');
        
        // 2. Buscar Unidades Existentes (para o select de unidade)
        // Pega apenas as unidades que realmente têm turmas cadastradas
        const unidadesRes = await db.query('SELECT DISTINCT unidade FROM turmas WHERE unidade IS NOT NULL ORDER BY unidade');

        // 3. Buscar Detalhes do Curso Selecionado
        let cursoDetalhes = null;
        if (curso_id) {
            cursoDetalhes = (await db.query('SELECT * FROM cursos WHERE id = $1', [curso_id])).rows[0];
        }

        // 4. Query Principal da Grade
        let queryText = `
            SELECT 
                t.id as turma_id, t.nome as turma_nome, t.semestre_ref, t.unidade,
                tu.slug as turno_slug, tu.id as turno_id,
                g.dia_semana, g.icone_dia, g.e_livre, g.sala,
                d.nome as disciplina_nome,
                p.nome as prof_nome
            FROM turmas t
            JOIN turnos tu ON t.turno_id = tu.id
            LEFT JOIN grade g ON g.turma_id = t.id
            LEFT JOIN disciplinas d ON g.disciplina_id = d.id
            LEFT JOIN professores p ON g.professor_id = p.id
            WHERE 1=1
        `;
        
        // Aplica Filtros
        if (curso_id) {
            queryText += ` AND t.curso_id = ${curso_id}`;
        }
        if (unidade) {
            queryText += ` AND t.unidade = '${unidade}'`;
        }
        
        // Ordenação
        queryText += ` ORDER BY CASE g.dia_semana WHEN 'SEG' THEN 1 WHEN 'TER' THEN 2 WHEN 'QUA' THEN 3 WHEN 'QUI' THEN 4 WHEN 'SEX' THEN 5 END`;

        const gradeRes = await db.query(queryText);

        // 5. Processamento dos Dados
        const turmasMap = new Map();
        const turnosComAula = new Set();

        gradeRes.rows.forEach(row => {
            turnosComAula.add(row.turno_slug);
            if (!turmasMap.has(row.turma_id)) {
                turmasMap.set(row.turma_id, {
                    id: row.turma_id,
                    nome: row.turma_nome,
                    semestre: row.semestre_ref,
                    unidade: row.unidade,
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
                    sala: row.sala,
                    livre: row.e_livre
                });
            }
        });

        // 6. Filtrar Turnos vazios
        const todosTurnos = (await db.query('SELECT * FROM turnos ORDER BY ordem ASC')).rows;
        const turnosFiltrados = todosTurnos.filter(t => 
            turnosComAula.has(t.slug) || (!curso_id && !unidade && turnosComAula.size === 0)
        );

        res.render('public/index', {
            turnos: turnosFiltrados.length > 0 ? turnosFiltrados : todosTurnos,
            cursos: cursosRes.rows,
            unidades: unidadesRes.rows, // Envia lista de unidades
            turmas: Array.from(turmasMap.values()),
            cursoSelecionado: curso_id,
            unidadeSelecionada: unidade, // Envia unidade escolhida
            cursoDetalhes: cursoDetalhes
        });

    } catch (err) {
        res.status(500).send("Erro ao carregar grade: " + err.message);
    }
};