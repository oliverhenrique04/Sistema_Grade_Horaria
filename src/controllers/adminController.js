const db = require('../database/db');

// --- LISTAR COM ORDENAÇÃO DE SEMESTRE ---
exports.listar = async (req, res) => {
    const tabela = req.params.entidade;
    const usuario = res.locals.usuarioLogado;
    const { filtro_curso } = req.query;

    try {
        let sql = `SELECT * FROM ${tabela} WHERE 1=1`;
        let params = [];
        let paramIndex = 1;

        if (tabela === 'turmas') {
            if (usuario.tipo === 'coordenador') {
                sql += ` AND curso_id = $${paramIndex++}`;
                params.push(usuario.curso_responsavel_id);
            }
            if (usuario.tipo === 'nap') {
                sql += ` AND unidade = $${paramIndex++}`;
                params.push(usuario.unidade_responsavel);
            }
            if (filtro_curso) {
                sql += ` AND curso_id = $${paramIndex++}`;
                params.push(filtro_curso);
            }
        }
        
        if (tabela === 'cursos' && usuario.tipo === 'coordenador') {
             sql += ` AND id = $${paramIndex++}`;
             params.push(usuario.curso_responsavel_id);
        }

        // --- LÓGICA DE ORDENAÇÃO ---
        if (tabela === 'turmas') {
            // Extrai o número do texto (ex: "1º" vira 1) e ordena ASC
            sql += ` ORDER BY CAST(SUBSTRING(semestre_ref FROM '^[0-9]+') AS INTEGER) ASC`;
        } else {
            // Para as outras tabelas (Professores, Cursos), mostra os mais novos primeiro
            sql += ` ORDER BY id DESC`;
        }

        const result = await db.query(sql, params);

        let listaCursosParaFiltro = [];
        if (tabela === 'turmas') {
            listaCursosParaFiltro = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
        }

        res.render('admin/listar', { 
            tabela, 
            itens: result.rows, 
            cursosFiltro: listaCursosParaFiltro,
            filtroAtual: filtro_curso
        });

    } catch (err) {
        res.status(500).send("Erro ao listar: " + err.message);
    }
};

// --- FORMULÁRIOS ---
exports.formCriar = async (req, res) => {
    const tabela = req.params.entidade;
    const usuario = res.locals.usuarioLogado;

    if (usuario.tipo === 'nap') return res.status(403).send("NAP não cria registros.");

    try {
        let opcoesCursos = [], opcoesTurnos = [];

        if (tabela === 'turmas') {
            if (usuario.tipo === 'admin') {
                opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
            } else {
                opcoesCursos = (await db.query('SELECT * FROM cursos WHERE id = $1', [usuario.curso_responsavel_id])).rows;
            }
            opcoesTurnos = (await db.query('SELECT * FROM turnos ORDER BY ordem')).rows;
        } 
        else if (tabela === 'usuarios') {
             opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
        }

        res.render('admin/form', { tabela, cursos: opcoesCursos, turnos: opcoesTurnos, item: undefined });
    } catch (err) {
        res.status(500).send("Erro: " + err.message);
    }
};

exports.formEditar = async (req, res) => {
    const { entidade, id } = req.params;
    const usuario = res.locals.usuarioLogado;

    if (usuario.tipo === 'nap') return res.status(403).send("NAP não edita registros.");

    try {
        const itemRes = await db.query(`SELECT * FROM ${entidade} WHERE id = $1`, [id]);
        const item = itemRes.rows[0];

        // Segurança Coordenador
        if (usuario.tipo === 'coordenador') {
            if (entidade === 'turmas' && item.curso_id !== usuario.curso_responsavel_id) {
                return res.status(403).send("Turma de outro curso.");
            }
            if (entidade === 'cursos' && item.id !== usuario.curso_responsavel_id) {
                return res.status(403).send("Acesso negado.");
            }
        }

        let opcoesCursos = [], opcoesTurnos = [];
        if (entidade === 'turmas') {
            if (usuario.tipo === 'admin') {
                opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
            } else {
                opcoesCursos = (await db.query('SELECT * FROM cursos WHERE id = $1', [usuario.curso_responsavel_id])).rows;
            }
            opcoesTurnos = (await db.query('SELECT * FROM turnos ORDER BY ordem')).rows;
        } else if (entidade === 'usuarios') {
             opcoesCursos = (await db.query('SELECT * FROM cursos ORDER BY nome')).rows;
        }

        res.render('admin/form', { tabela: entidade, cursos: opcoesCursos, turnos: opcoesTurnos, item: item });
    } catch (err) {
        res.status(500).send("Erro: " + err.message);
    }
};

// --- SALVAR (Com Unidade e Roles) ---
exports.salvar = async (req, res) => {
    const tabela = req.params.entidade;
    const dados = req.body;
    const token = req.query.token;
    const usuario = res.locals.usuarioLogado;

    if (usuario.tipo === 'nap') return res.status(403).send("Acesso Negado.");

    try {
        if (tabela === 'turmas') {
            const cursoFinal = usuario.tipo === 'coordenador' ? usuario.curso_responsavel_id : dados.curso_id;
            await db.query(
                `INSERT INTO turmas (nome, semestre_ref, curso_id, turno_id, unidade) VALUES ($1, $2, $3, $4, $5)`,
                [dados.nome, dados.semestre_ref, cursoFinal, dados.turno_id, dados.unidade]
            );
        } else if (tabela === 'usuarios') {
            const cursoId = dados.curso_responsavel_id || null;
            const unidadeResp = dados.unidade_responsavel || null;
            await db.query(
                `INSERT INTO usuarios (nome, email, senha, tipo, token_acesso, curso_responsavel_id, unidade_responsavel) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [dados.nome, dados.email, dados.senha, dados.tipo, dados.token_acesso, cursoId, unidadeResp]
            );
        } else if (tabela === 'cursos') {
            await db.query(
                `INSERT INTO cursos (nome, coordenador, semestres_total) VALUES ($1, $2, $3)`,
                [dados.nome, dados.coordenador, dados.semestres_total]
            );
        } else if (tabela === 'turnos') {
             await db.query(`INSERT INTO turnos (nome, slug) VALUES ($1, LOWER($1))`, [dados.nome]);
        } else {
            await db.query(`INSERT INTO ${tabela} (nome) VALUES ($1)`, [dados.nome]);
        }
        res.redirect(`/admin/${tabela}?token=${token}`);
    } catch (err) {
        res.status(500).send("Erro ao salvar: " + err.message);
    }
};

exports.atualizar = async (req, res) => {
    const { entidade, id } = req.params;
    const dados = req.body;
    const token = req.query.token;
    const usuario = res.locals.usuarioLogado;

    if (usuario.tipo === 'nap') return res.status(403).send("Acesso Negado.");

    try {
        if (entidade === 'turmas') {
             const cursoFinal = usuario.tipo === 'coordenador' ? usuario.curso_responsavel_id : dados.curso_id;
            await db.query(
                `UPDATE turmas SET nome=$1, semestre_ref=$2, curso_id=$3, turno_id=$4, unidade=$5 WHERE id=$6`,
                [dados.nome, dados.semestre_ref, cursoFinal, dados.turno_id, dados.unidade, id]
            );
        } else if (entidade === 'usuarios') {
            const cursoId = dados.curso_responsavel_id || null;
            const unidadeResp = dados.unidade_responsavel || null;
            await db.query(
                `UPDATE usuarios SET nome=$1, email=$2, senha=$3, tipo=$4, token_acesso=$5, curso_responsavel_id=$6, unidade_responsavel=$7 WHERE id=$8`,
                [dados.nome, dados.email, dados.senha, dados.tipo, dados.token_acesso, cursoId, unidadeResp, id]
            );
        } else if (entidade === 'cursos') {
            await db.query(
                `UPDATE cursos SET nome=$1, coordenador=$2, semestres_total=$3 WHERE id=$4`,
                [dados.nome, dados.coordenador, dados.semestres_total, id]
            );
        } else {
            await db.query(`UPDATE ${entidade} SET nome=$1 WHERE id=$2`, [dados.nome, id]);
        }
        res.redirect(`/admin/${entidade}?token=${token}`);
    } catch (err) {
        res.status(500).send("Erro ao atualizar: " + err.message);
    }
};

exports.excluir = async (req, res) => {
    const tabela = req.params.entidade;
    const { id } = req.params;
    const token = req.query.token;
    const usuario = res.locals.usuarioLogado;
    
    if (usuario.tipo === 'nap') return res.status(403).send("Proibido.");
    
    try {
        await db.query(`DELETE FROM ${tabela} WHERE id = $1`, [id]);
        res.redirect(`/admin/${tabela}?token=${token}`);
    } catch (err) {
        if (err.code === '23503') res.status(400).send("Erro: Dependências encontradas.");
        else res.status(500).send("Erro: " + err.message);
    }
};

// --- GRADE ---
exports.montarGrade = async (req, res) => {
    const { id } = req.params;
    const usuario = res.locals.usuarioLogado;
    try {
        const turma = (await db.query('SELECT * FROM turmas WHERE id = $1', [id])).rows[0];

        // Segurança NAP (Verifica unidade)
        if (usuario.tipo === 'nap' && turma.unidade !== usuario.unidade_responsavel) {
            return res.status(403).send(`Acesso Negado: Esta turma é de ${turma.unidade}, você é de ${usuario.unidade_responsavel}.`);
        }
        // Segurança Coordenador
        if (usuario.tipo === 'coordenador' && turma.curso_id !== usuario.curso_responsavel_id) {
            return res.status(403).send("Acesso Negado.");
        }
        
        const grade = await db.query(`
            SELECT g.id, g.dia_semana, g.sala, d.nome as disciplina, p.nome as professor
            FROM grade g JOIN disciplinas d ON g.disciplina_id = d.id JOIN professores p ON g.professor_id = p.id
            WHERE g.turma_id = $1
            ORDER BY CASE g.dia_semana WHEN 'SEG' THEN 1 WHEN 'TER' THEN 2 WHEN 'QUA' THEN 3 WHEN 'QUI' THEN 4 WHEN 'SEX' THEN 5 END
        `, [id]);
        const profs = await db.query('SELECT * FROM professores ORDER BY nome');
        const disc = await db.query('SELECT * FROM disciplinas ORDER BY nome');
        res.render('admin/montar_grade', { turma, grade: grade.rows, professores: profs.rows, disciplinas: disc.rows });
    } catch (err) { res.status(500).send(err.message); }
};

exports.adicionarItemGrade = async (req, res) => {
    const { id } = req.params;
    const { dia_semana, disciplina_id, professor_id, sala } = req.body;
    const token = req.query.token;
    const usuario = res.locals.usuarioLogado;

    // NAP não adiciona, só edita sala
    if (usuario.tipo === 'nap') return res.status(403).send("NAP não adiciona disciplinas.");

    try {
        // --- REMOVIDO: BLOQUEIO DE DUPLICIDADE ---
        // Agora o sistema permite adicionar quantas aulas quiser no mesmo dia.
        
        await db.query(`
            INSERT INTO grade (turma_id, dia_semana, disciplina_id, professor_id, sala)
            VALUES ($1, $2, $3, $4, $5)
        `, [id, dia_semana, disciplina_id, professor_id, sala]);

        res.redirect(`/admin/turmas/${id}/grade?token=${token}`);
    } catch (err) {
        res.status(500).send("Erro ao adicionar: " + err.message);
    }
};

exports.removerItemGrade = async (req, res) => {
    const { id, id_item } = req.params;
    const token = req.query.token;
    const usuario = res.locals.usuarioLogado;
    if (usuario.tipo === 'nap') return res.status(403).send("NAP não remove.");

    await db.query('DELETE FROM grade WHERE id = $1', [id_item]);
    res.redirect(`/admin/turmas/${id}/grade?token=${token}`);
};

exports.atualizarSalaGrade = async (req, res) => {
    const { id, id_item } = req.params;
    const { sala } = req.body;
    const token = req.query.token;
    await db.query('UPDATE grade SET sala = $1 WHERE id = $2', [sala, id_item]);
    res.redirect(`/admin/turmas/${id}/grade?token=${token}`);
};