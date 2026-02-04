const db = require('../database/db');

// --- DASHBOARD ---
exports.getDashboard = (req, res) => {
    res.render('admin/dashboard');
};

// --- CRUD GENÉRICO (LISTAR) ---
exports.listar = async (req, res) => {
    const tabela = req.params.entidade; // 'professores', 'cursos', etc.
    // Validação de segurança simples para evitar SQL Injection na tabela
    const tabelasPermitidas = ['usuarios', 'cursos', 'disciplinas', 'professores', 'turnos', 'turmas'];
    if (!tabelasPermitidas.includes(tabela)) return res.status(403).send("Tabela inválida");

    try {
        const resultado = await db.query(`SELECT * FROM ${tabela} ORDER BY id DESC`);
        res.render('admin/listar', { tabela, itens: resultado.rows });
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// --- CRUD GENÉRICO (CRIAR - POST) ---
exports.criar = async (req, res) => {
    const tabela = req.params.entidade;
    const dados = req.body;
    
    // Mapeamento simples de campos baseados no body
    // Em produção, validação rigorosa é necessária
    try {
        const chaves = Object.keys(dados).join(', ');
        const valores = Object.values(dados);
        const placeholders = valores.map((_, i) => `$${i + 1}`).join(', ');

        await db.query(`INSERT INTO ${tabela} (${chaves}) VALUES (${placeholders})`, valores);
        res.redirect(`/admin/${tabela}`);
    } catch (err) {
        res.status(500).send(err.message);
    }
};

// --- FORMULÁRIO DE CRIAÇÃO (ATUALIZADO PARA BUSCAR DADOS) ---
exports.formCriar = async (req, res) => {
    const tabela = req.params.entidade;
    
    try {
        let opcoesCursos = [];
        let opcoesTurnos = [];

        // Se estivermos criando uma TURMA, precisamos buscar as opções no banco
        if (tabela === 'turmas') {
            const cursosRes = await db.query('SELECT * FROM cursos ORDER BY nome');
            const turnosRes = await db.query('SELECT * FROM turnos ORDER BY ordem');
            
            opcoesCursos = cursosRes.rows;
            opcoesTurnos = turnosRes.rows;
        }

        res.render('admin/form', { 
            tabela, 
            cursos: opcoesCursos, 
            turnos: opcoesTurnos 
        });

    } catch (err) {
        res.status(500).send("Erro ao carregar formulário: " + err.message);
    }
};

// ... (código anterior)

// --- TELA DE MONTAR GRADE (Onde a mágica acontece) ---
exports.montarGrade = async (req, res) => {
    const { id } = req.params; // ID da Turma

    try {
        // 1. Buscar dados da Turma
        const turmaRes = await db.query('SELECT * FROM turmas WHERE id = $1', [id]);
        const turma = turmaRes.rows[0];

        // 2. Buscar a Grade ATUAL dessa turma (para listar o que já está cadastrado)
        const gradeRes = await db.query(`
            SELECT g.id, g.dia_semana, d.nome as disciplina, p.nome as professor
            FROM grade g
            JOIN disciplinas d ON g.disciplina_id = d.id
            JOIN professores p ON g.professor_id = p.id
            WHERE g.turma_id = $1
            ORDER BY 
                CASE g.dia_semana 
                    WHEN 'SEG' THEN 1 WHEN 'TER' THEN 2 WHEN 'QUA' THEN 3 
                    WHEN 'QUI' THEN 4 WHEN 'SEX' THEN 5 
                END
        `, [id]);

        // 3. Buscar listas para os Dropdowns (Selects)
        const profsRes = await db.query('SELECT * FROM professores ORDER BY nome');
        const discRes = await db.query('SELECT * FROM disciplinas ORDER BY nome');

        res.render('admin/montar_grade', {
            turma,
            grade: gradeRes.rows,
            professores: profsRes.rows,
            disciplinas: discRes.rows
        });

    } catch (err) {
        res.status(500).send("Erro ao abrir grade: " + err.message);
    }
};

// --- SALVAR ITEM NA GRADE ---
exports.adicionarItemGrade = async (req, res) => {
    const { id } = req.params; // ID da Turma
    const { dia_semana, disciplina_id, professor_id } = req.body;

    try {
        await db.query(`
            INSERT INTO grade (turma_id, dia_semana, disciplina_id, professor_id)
            VALUES ($1, $2, $3, $4)
        `, [id, dia_semana, disciplina_id, professor_id]);

        res.redirect(`/admin/turmas/${id}/grade`); // Recarrega a mesma página
    } catch (err) {
        res.status(500).send("Erro ao adicionar aula: " + err.message);
    }
};

// --- REMOVER ITEM DA GRADE ---
exports.removerItemGrade = async (req, res) => {
    const { id, id_item } = req.params;
    await db.query('DELETE FROM grade WHERE id = $1', [id_item]);
    res.redirect(`/admin/turmas/${id}/grade`);
};

// --- EXCLUIR REGISTRO ---
exports.excluir = async (req, res) => {
    const tabela = req.params.entidade;
    const { id } = req.params;

    // Lista de segurança
    const tabelasPermitidas = ['usuarios', 'cursos', 'disciplinas', 'professores', 'turnos', 'turmas', 'grade'];
    if (!tabelasPermitidas.includes(tabela)) return res.status(403).send("Tabela inválida");

    try {
        await db.query(`DELETE FROM ${tabela} WHERE id = $1`, [id]);
        res.redirect(`/admin/${tabela}`);
    } catch (err) {
        // Erro comum: Tentar apagar um Curso que tem Turmas (Foreign Key)
        if (err.code === '23503') {
            res.status(400).send(`
                <h1>Não foi possível excluir</h1>
                <p>Este item está sendo usado em outro lugar do sistema (Ex: Um curso que tem turmas, ou um professor que tem aulas).</p>
                <p>Delete os itens dependentes primeiro.</p>
                <a href="/admin/${tabela}">Voltar</a>
            `);
        } else {
            res.status(500).send("Erro ao excluir: " + err.message);
        }
    }
};