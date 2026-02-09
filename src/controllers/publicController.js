const db = require('../database/db');

const slugify = (value = '') =>
    String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const addFriendlySlug = (rows, labelKey) => {
    const used = new Set();

    return rows.map((row) => {
        const base = slugify(row[labelKey]) || 'item';
        let slug = base;
        let count = 2;

        while (used.has(slug)) {
            slug = `${base}-${count++}`;
        }

        used.add(slug);
        return { ...row, slug };
    });
};

const withBase = (req, target = '/') => {
    const base = req.basePathPrefix || '';
    const normalizedTarget = String(target || '/').startsWith('/')
        ? String(target || '/')
        : `/${String(target || '/')}`;
    return `${base}${normalizedTarget}`;
};

const buildPublicUrl = (req, unidadeSlug, cursoSlug) => {
    const params = new URLSearchParams();

    if (unidadeSlug) params.set('unidade', unidadeSlug);
    if (unidadeSlug && cursoSlug) params.set('curso', cursoSlug);

    const query = params.toString();
    const relative = query ? `/?${query}` : '/';
    return withBase(req, relative);
};

exports.getGradePage = async (req, res) => {
    try {
        const unidadeParam = typeof req.query.unidade === 'string' ? req.query.unidade.trim() : '';
        const cursoParam = typeof req.query.curso === 'string' ? req.query.curso.trim() : '';
        const cursoIdLegado = typeof req.query.curso_id === 'string' ? req.query.curso_id.trim() : '';

        // 1. Buscas auxiliares
        const cursosRes = await db.query('SELECT id, nome, coordenador, semestres_total FROM cursos ORDER BY nome, id');
        const unidadesRes = await db.query('SELECT DISTINCT unidade FROM turmas WHERE unidade IS NOT NULL ORDER BY unidade');

        const cursosBase = addFriendlySlug(cursosRes.rows, 'nome');
        const unidadesBase = addFriendlySlug(
            unidadesRes.rows.map((row) => ({ nome: row.unidade })),
            'nome'
        );

        const unidadeSelecionadaObj = unidadeParam
            ? (unidadesBase.find((u) => u.slug === unidadeParam)
                || unidadesBase.find((u) => u.nome.toLowerCase() === unidadeParam.toLowerCase()))
            : null;

        const unidadeSelecionada = unidadeSelecionadaObj ? unidadeSelecionadaObj.nome : '';
        const unidadeSelecionadaSlug = unidadeSelecionadaObj ? unidadeSelecionadaObj.slug : '';

        // Lista de cursos disponíveis apenas após selecionar unidade
        let cursosDisponiveisIds = new Set();
        if (unidadeSelecionada) {
            const cursosDaUnidadeRes = await db.query(
                `
                SELECT DISTINCT c.id
                FROM cursos c
                JOIN turmas t ON t.curso_id = c.id
                WHERE t.unidade = $1
                `,
                [unidadeSelecionada]
            );
            cursosDisponiveisIds = new Set(cursosDaUnidadeRes.rows.map((row) => row.id));
        }

        const cursosFiltrados = unidadeSelecionada
            ? cursosBase.filter((c) => cursosDisponiveisIds.has(c.id))
            : [];

        let cursoSelecionadoObj = null;
        if (cursoParam) {
            cursoSelecionadoObj =
                cursosBase.find((c) => c.slug === cursoParam)
                || cursosBase.find((c) => c.nome.toLowerCase() === cursoParam.toLowerCase());
        } else if (cursoIdLegado) {
            cursoSelecionadoObj = cursosBase.find((c) => String(c.id) === cursoIdLegado);
        }

        if (cursoSelecionadoObj && unidadeSelecionada && !cursosDisponiveisIds.has(cursoSelecionadoObj.id)) {
            cursoSelecionadoObj = null;
        }

        if (!unidadeSelecionada) {
            cursoSelecionadoObj = null;
        }

        const cursoSelecionadoSlug = cursoSelecionadoObj ? cursoSelecionadoObj.slug : '';
        const cursoSelecionadoId = cursoSelecionadoObj ? cursoSelecionadoObj.id : null;

        let cursoDetalhes = null;
        if (cursoSelecionadoId) {
            cursoDetalhes = (await db.query('SELECT * FROM cursos WHERE id = $1', [cursoSelecionadoId])).rows[0];
        }

        // Canonicaliza URL pública para parâmetros amigáveis e sem ids numéricos
        const precisaRedirecionar =
            Boolean(cursoIdLegado)
            || Boolean(unidadeParam && !unidadeSelecionadaObj)
            || Boolean(unidadeParam && unidadeSelecionadaObj && unidadeParam !== unidadeSelecionadaSlug)
            || Boolean(cursoParam && cursoParam !== cursoSelecionadoSlug)
            || Boolean(cursoParam && !unidadeSelecionada);

        if (precisaRedirecionar) {
            return res.redirect(buildPublicUrl(req, unidadeSelecionadaSlug, cursoSelecionadoSlug));
        }

        const filtrosCompletos = Boolean(cursoSelecionadoId && unidadeSelecionada);

        if (!filtrosCompletos) {
            return res.render('public/index', {
                turnos: [],
                cursos: cursosFiltrados,
                unidades: unidadesBase,
                turmas: [],
                cursoSelecionado: cursoSelecionadoSlug || '',
                unidadeSelecionada: unidadeSelecionada || '',
                unidadeSelecionadaSlug: unidadeSelecionadaSlug || '',
                cursoDetalhes: cursoDetalhes,
                deveSelecionarFiltros: true
            });
        }

        // 2. QUERY PRINCIPAL
        const params = [];
        let where = 'WHERE 1=1';

        if (cursoSelecionadoId) {
            params.push(cursoSelecionadoId);
            where += ` AND t.curso_id = $${params.length}`;
        }

        if (unidadeSelecionada) {
            params.push(unidadeSelecionada);
            where += ` AND t.unidade = $${params.length}`;
        }

        const queryText = `
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
            ${where}
            ORDER BY 
                CAST(SUBSTRING(t.semestre_ref FROM '^[0-9]+') AS INTEGER) ASC, 
                t.nome ASC,
                CASE g.dia_semana 
                    WHEN 'SEG' THEN 1 WHEN 'TER' THEN 2 WHEN 'QUA' THEN 3 
                    WHEN 'QUI' THEN 4 WHEN 'SEX' THEN 5 
                END,
                g.id ASC
        `;

        const gradeRes = await db.query(queryText, params);

        // 3. Processamento (AGRUPAMENTO POR DIA)
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
                    diasMap: new Map() // Usamos um Map interno para agrupar aulas por dia
                });
            }

            if (row.dia_semana) {
                const turma = turmasMap.get(row.turma_id);
                
                // Se o dia ainda não existe na turma, cria ele
                if (!turma.diasMap.has(row.dia_semana)) {
                    turma.diasMap.set(row.dia_semana, {
                        dia: row.dia_semana,
                        icone: row.icone_dia,
                        aulas: [] // Lista de aulas DENTRO deste dia
                    });
                }

                // Adiciona a aula na lista daquele dia
                turma.diasMap.get(row.dia_semana).aulas.push({
                    disciplina: row.disciplina_nome,
                    prof: row.prof_nome,
                    sala: row.sala,
                    livre: row.e_livre
                });
            }
        });

        // 4. Converter Maps para Arrays para o EJS ler
        const turmasFinais = Array.from(turmasMap.values()).map(turma => {
            return {
                ...turma,
                dias: Array.from(turma.diasMap.values()) // Transforma o Map de dias em Array
            };
        });

        const todosTurnos = (await db.query('SELECT * FROM turnos ORDER BY ordem ASC')).rows;
        const turnosFiltrados = todosTurnos.filter(t => turnosComAula.has(t.slug));

        res.render('public/index', {
            turnos: turnosFiltrados.length > 0 ? turnosFiltrados : todosTurnos,
            cursos: cursosFiltrados,
            unidades: unidadesBase,
            turmas: turmasFinais,
            cursoSelecionado: cursoSelecionadoSlug,
            unidadeSelecionada: unidadeSelecionada,
            unidadeSelecionadaSlug: unidadeSelecionadaSlug,
            cursoDetalhes: cursoDetalhes,
            deveSelecionarFiltros: false
        });

    } catch (err) {
        res.status(500).send("Erro ao carregar grade: " + err.message);
    }
};
