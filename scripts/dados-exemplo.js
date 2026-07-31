#!/usr/bin/env node
/**
 * Carga de dados de demonstracao para avaliar o ambiente.
 *
 *   node scripts/dados-exemplo.js criar     Insere os dados de exemplo
 *   node scripts/dados-exemplo.js remover   Remove exatamente o que foi inserido
 *
 * As aulas sao criadas pelo `aulaService`, ou seja, passam pelas mesmas regras
 * de conflito da aplicacao: o que entra aqui e necessariamente uma grade valida.
 *
 * Tudo o que este script cria e identificavel: cursos, disciplinas, professores,
 * locais e usuarios estao nas listas abaixo e as turmas usam codigos proprios.
 * A remocao apaga apenas esses registros, em ordem reversa de dependencia.
 */
const db = require('../src/config/db');
const aulaService = require('../src/services/aulaService');
const { gerarHash } = require('../src/services/autenticacaoService');

// ---------------------------------------------------------------------------
// Definicao dos dados
// ---------------------------------------------------------------------------

const CURSOS = [
    {
        nome: 'Ciência da Computação',
        sigla: 'CC',
        coordenador: 'Prof. Michel Junio',
        semestres: 8,
        campus: ['Águas Claras'],
    },
    {
        nome: 'Enfermagem',
        sigla: 'ENF',
        coordenador: 'Profa. Talita Moreira',
        semestres: 10,
        campus: ['Águas Claras', 'Asa Sul'],
    },
];

const DISCIPLINAS = {
    'Ciência da Computação': [
        { nome: 'Algoritmos e Programação', codigo: 'CC101', carga: 80, semestre: 1 },
        { nome: 'Cálculo I', codigo: 'CC102', carga: 60, semestre: 1 },
        { nome: 'Arquitetura de Computadores', codigo: 'CC103', carga: 60, semestre: 1 },
        { nome: 'Estrutura de Dados', codigo: 'CC201', carga: 80, semestre: 3 },
        { nome: 'Banco de Dados I', codigo: 'CC202', carga: 60, semestre: 3 },
        { nome: 'Engenharia de Software', codigo: 'CC203', carga: 60, semestre: 3 },
        { nome: 'Redes de Computadores', codigo: 'CC204', carga: 60, semestre: 3 },
        { nome: 'Programação Web', codigo: 'CC205', carga: 80, semestre: 3 },
    ],
    Enfermagem: [
        { nome: 'Anatomia Humana', codigo: 'ENF101', carga: 80, semestre: 2 },
        { nome: 'Fisiologia Humana', codigo: 'ENF102', carga: 60, semestre: 2 },
        { nome: 'Bioquímica Aplicada', codigo: 'ENF103', carga: 60, semestre: 2 },
        { nome: 'Semiologia e Semiotécnica', codigo: 'ENF201', carga: 80, semestre: 4 },
        { nome: 'Farmacologia Clínica', codigo: 'ENF202', carga: 60, semestre: 4 },
        { nome: 'Saúde Coletiva', codigo: 'ENF203', carga: 60, semestre: 4 },
        { nome: 'Ética e Legislação em Enfermagem', codigo: 'ENF204', carga: 40, semestre: 4 },
    ],
};

const PROFESSORES = [
    { nome: 'Prof. Edward Lima', email: 'edward.lima@exemplo.edu.br' },
    { nome: 'Prof. Paulo Augusto', email: 'paulo.augusto@exemplo.edu.br' },
    { nome: 'Profa. Jorgina Osvaldo', email: 'jorgina.osvaldo@exemplo.edu.br' },
    { nome: 'Prof. Hyago Santana', email: 'hyago.santana@exemplo.edu.br' },
    { nome: 'Profa. Carla Danielle', email: 'carla.danielle@exemplo.edu.br' },
    { nome: 'Profa. Marina Prado', email: 'marina.prado@exemplo.edu.br' },
    { nome: 'Prof. Rafael Nunes', email: 'rafael.nunes@exemplo.edu.br' },
    { nome: 'Profa. Beatriz Rocha', email: 'beatriz.rocha@exemplo.edu.br' },
    { nome: 'Profa. Lúcia Ferraz', email: 'lucia.ferraz@exemplo.edu.br' },
    { nome: 'Prof. Tiago Moura', email: 'tiago.moura@exemplo.edu.br' },
];

const LOCAIS = [
    { campus: 'Águas Claras', nome: '201 C', codigo: 'C201', tipo: 'sala', capacidade: 45 },
    { campus: 'Águas Claras', nome: '202 C', codigo: 'C202', tipo: 'sala', capacidade: 45 },
    { campus: 'Águas Claras', nome: '305 D', codigo: 'D305', tipo: 'sala', capacidade: 50 },
    {
        campus: 'Águas Claras',
        nome: 'Lab 01',
        codigo: 'LAB01',
        tipo: 'laboratorio',
        capacidade: 30,
    },
    {
        campus: 'Águas Claras',
        nome: 'Lab 02',
        codigo: 'LAB02',
        tipo: 'laboratorio',
        capacidade: 30,
    },
    {
        campus: 'Águas Claras',
        nome: 'Skill Lab',
        codigo: 'SKILL',
        tipo: 'skill_lab',
        capacidade: 24,
    },
    {
        campus: 'Águas Claras',
        nome: 'Auditório Central',
        codigo: 'AUD',
        tipo: 'auditorio',
        capacidade: 120,
    },
    { campus: 'Águas Claras', nome: 'EAD', codigo: 'EAD-AC', tipo: 'virtual', capacidade: null },
    { campus: 'Asa Sul', nome: '110 B', codigo: 'B110', tipo: 'sala', capacidade: 40 },
    {
        campus: 'Asa Sul',
        nome: 'Skill Lab AS',
        codigo: 'SKILL-AS',
        tipo: 'skill_lab',
        capacidade: 20,
    },
    { campus: 'Asa Sul', nome: 'EAD', codigo: 'EAD-AS', tipo: 'virtual', capacidade: null },
];

const TURMAS = [
    {
        codigo: 'CC1M',
        nome: 'Computação 1º Semestre (Manhã)',
        curso: 'Ciência da Computação',
        campus: 'Águas Claras',
        semestre: 1,
        turno: 'matutino',
    },
    {
        codigo: 'CC3M',
        nome: 'Computação 3º Semestre (Manhã)',
        curso: 'Ciência da Computação',
        campus: 'Águas Claras',
        semestre: 3,
        turno: 'matutino',
    },
    {
        codigo: 'CC1N',
        nome: 'Computação 1º Semestre (Noite)',
        curso: 'Ciência da Computação',
        campus: 'Águas Claras',
        semestre: 1,
        turno: 'noturno',
    },
    {
        codigo: 'ENF2M',
        nome: 'Enfermagem 2º Semestre (Manhã)',
        curso: 'Enfermagem',
        campus: 'Águas Claras',
        semestre: 2,
        turno: 'matutino',
    },
    {
        codigo: 'ENF4N',
        nome: 'Enfermagem 4º Semestre (Noite)',
        curso: 'Enfermagem',
        campus: 'Águas Claras',
        semestre: 4,
        turno: 'noturno',
    },
    {
        codigo: 'ENF2M-AS',
        nome: 'Enfermagem 2º Semestre (Asa Sul)',
        curso: 'Enfermagem',
        campus: 'Asa Sul',
        semestre: 2,
        turno: 'matutino',
    },
];

const USUARIOS = [
    {
        nome: 'Coordenação Computação',
        email: 'coord.computacao@exemplo.edu.br',
        perfil: 'coordenador',
        senha: 'Coord@2026',
        cursos: ['Ciência da Computação'],
        campus: [],
    },
    {
        nome: 'Coordenação Enfermagem',
        email: 'coord.enfermagem@exemplo.edu.br',
        perfil: 'coordenador',
        senha: 'Coord@2026',
        cursos: ['Enfermagem'],
        campus: [],
    },
    {
        nome: 'NAP Águas Claras',
        email: 'nap.aguasclaras@exemplo.edu.br',
        perfil: 'nap',
        senha: 'Nap@2026',
        cursos: [],
        campus: ['Águas Claras'],
    },
];

/**
 * Grade de cada turma: [dia (1=segunda), ordem do horario, disciplina, professor,
 * local, modalidade]. `local: null` cria uma pendencia proposital de sala.
 */
const GRADES = {
    CC1M: [
        [1, 1, 'Algoritmos e Programação', 'Prof. Paulo Augusto', 'Lab 01', 'presencial'],
        [1, 2, 'Algoritmos e Programação', 'Prof. Paulo Augusto', 'Lab 01', 'presencial'],
        [2, 1, 'Cálculo I', 'Profa. Jorgina Osvaldo', '201 C', 'presencial'],
        [2, 2, 'Cálculo I', 'Profa. Jorgina Osvaldo', '201 C', 'presencial'],
        [3, 1, 'Arquitetura de Computadores', 'Prof. Edward Lima', '202 C', 'presencial'],
        [3, 2, 'Arquitetura de Computadores', 'Prof. Edward Lima', '202 C', 'presencial'],
        [4, 1, 'Algoritmos e Programação', 'Prof. Paulo Augusto', 'Lab 01', 'presencial'],
        [4, 2, 'Cálculo I', 'Profa. Jorgina Osvaldo', '201 C', 'presencial'],
        [5, 1, 'Arquitetura de Computadores', 'Prof. Edward Lima', 'EAD', 'ead'],
    ],
    CC3M: [
        [1, 3, 'Estrutura de Dados', 'Prof. Hyago Santana', 'Lab 02', 'presencial'],
        [1, 4, 'Estrutura de Dados', 'Prof. Hyago Santana', 'Lab 02', 'presencial'],
        [2, 3, 'Banco de Dados I', 'Prof. Hyago Santana', 'Lab 02', 'presencial'],
        [2, 4, 'Banco de Dados I', 'Prof. Hyago Santana', 'Lab 02', 'presencial'],
        [3, 3, 'Engenharia de Software', 'Prof. Edward Lima', '305 D', 'presencial'],
        [3, 4, 'Redes de Computadores', 'Prof. Edward Lima', '305 D', 'presencial'],
        [4, 3, 'Programação Web', 'Prof. Rafael Nunes', 'Lab 01', 'presencial'],
        [4, 4, 'Programação Web', 'Prof. Rafael Nunes', 'Lab 01', 'presencial'],
        [5, 3, 'Engenharia de Software', 'Prof. Edward Lima', null, 'presencial'],
    ],
    CC1N: [
        [1, 1, 'Algoritmos e Programação', 'Prof. Rafael Nunes', 'Lab 01', 'presencial'],
        [1, 2, 'Algoritmos e Programação', 'Prof. Rafael Nunes', 'Lab 01', 'presencial'],
        [2, 1, 'Cálculo I', 'Profa. Jorgina Osvaldo', '201 C', 'presencial'],
        [2, 2, 'Cálculo I', 'Profa. Jorgina Osvaldo', '201 C', 'presencial'],
        [3, 1, 'Arquitetura de Computadores', 'Prof. Edward Lima', '202 C', 'presencial'],
        [4, 1, 'Algoritmos e Programação', 'Prof. Rafael Nunes', 'EAD', 'ead'],
        [4, 2, 'Algoritmos e Programação', 'Prof. Rafael Nunes', 'EAD', 'ead'],
        [5, 1, 'Cálculo I', 'Profa. Jorgina Osvaldo', null, 'presencial'],
    ],
    ENF2M: [
        [1, 1, 'Anatomia Humana', 'Profa. Carla Danielle', 'Skill Lab', 'presencial'],
        [1, 2, 'Anatomia Humana', 'Profa. Carla Danielle', 'Skill Lab', 'presencial'],
        [2, 1, 'Fisiologia Humana', 'Profa. Marina Prado', '305 D', 'presencial'],
        [2, 2, 'Fisiologia Humana', 'Profa. Marina Prado', '305 D', 'presencial'],
        [3, 1, 'Bioquímica Aplicada', 'Profa. Beatriz Rocha', 'Auditório Central', 'presencial'],
        [3, 2, 'Bioquímica Aplicada', 'Profa. Beatriz Rocha', 'Auditório Central', 'presencial'],
        [4, 1, 'Anatomia Humana', 'Profa. Carla Danielle', 'Skill Lab', 'presencial'],
        [4, 2, 'Fisiologia Humana', 'Profa. Marina Prado', '305 D', 'presencial'],
        [5, 1, 'Bioquímica Aplicada', 'Profa. Beatriz Rocha', 'EAD', 'ead'],
    ],
    ENF4N: [
        [1, 1, 'Semiologia e Semiotécnica', 'Profa. Carla Danielle', 'Skill Lab', 'presencial'],
        [1, 2, 'Semiologia e Semiotécnica', 'Profa. Carla Danielle', 'Skill Lab', 'presencial'],
        [2, 1, 'Farmacologia Clínica', 'Profa. Beatriz Rocha', '202 C', 'presencial'],
        [2, 2, 'Farmacologia Clínica', 'Profa. Beatriz Rocha', '202 C', 'presencial'],
        [3, 1, 'Saúde Coletiva', 'Profa. Marina Prado', '305 D', 'presencial'],
        [3, 2, 'Saúde Coletiva', 'Profa. Marina Prado', '305 D', 'presencial'],
        [
            4,
            1,
            'Ética e Legislação em Enfermagem',
            'Profa. Marina Prado',
            'Auditório Central',
            'presencial',
        ],
        [5, 1, 'Semiologia e Semiotécnica', 'Profa. Carla Danielle', null, 'hibrido'],
    ],
    'ENF2M-AS': [
        [1, 1, 'Anatomia Humana', 'Profa. Lúcia Ferraz', 'Skill Lab AS', 'presencial'],
        [1, 2, 'Anatomia Humana', 'Profa. Lúcia Ferraz', 'Skill Lab AS', 'presencial'],
        [2, 1, 'Fisiologia Humana', 'Prof. Tiago Moura', '110 B', 'presencial'],
        [3, 1, 'Bioquímica Aplicada', 'Profa. Lúcia Ferraz', '110 B', 'presencial'],
        [3, 2, 'Bioquímica Aplicada', 'Profa. Lúcia Ferraz', '110 B', 'presencial'],
        [4, 1, 'Fisiologia Humana', 'Prof. Tiago Moura', 'EAD', 'ead'],
    ],
};

/**
 * Aulas propositalmente sem horario, para exercitar o painel de pendencias
 * do montador e o indicador "aulas sem horário" do dashboard.
 */
const PENDENCIAS = [
    { turma: 'CC3M', disciplina: 'Redes de Computadores', professor: 'Prof. Edward Lima' },
    { turma: 'ENF4N', disciplina: 'Ética e Legislação em Enfermagem', professor: null },
];

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------

const umPorChave = (linhas, chave) => new Map(linhas.map((linha) => [linha[chave], linha]));

const criar = async () => {
    const resumo = {
        cursos: 0,
        disciplinas: 0,
        professores: 0,
        locais: 0,
        turmas: 0,
        aulas: 0,
        pendencias: 0,
        usuarios: 0,
    };

    const { campusPorNome, turnoPorSlug, periodo } = await db.transacao(async (cliente) => {
        const campus = await cliente.query('SELECT id, nome FROM campus');
        const turnos = await cliente.query('SELECT id, slug FROM turnos');
        const periodos = await cliente.query(
            'SELECT id, codigo FROM periodos_letivos WHERE atual AND ativo LIMIT 1'
        );

        if (periodos.rowCount === 0) {
            throw new Error('Nenhum periodo letivo atual definido. Rode "npm run seed" antes.');
        }

        return {
            campusPorNome: umPorChave(campus.rows, 'nome'),
            turnoPorSlug: umPorChave(turnos.rows, 'slug'),
            periodo: periodos.rows[0],
        };
    });

    const exigirCampus = (nome) => {
        const encontrado = campusPorNome.get(nome);
        if (!encontrado) throw new Error(`Campus nao encontrado: ${nome}`);
        return encontrado.id;
    };

    // 1. Cursos e vinculo com campus
    const cursoPorNome = new Map();
    for (const curso of CURSOS) {
        const linha = await db.query(
            `INSERT INTO cursos (nome, sigla, coordenador, semestres_total, ativo)
             VALUES ($1, $2, $3, $4, TRUE)
             ON CONFLICT (nome) DO UPDATE SET sigla = EXCLUDED.sigla
             RETURNING id, (xmax = 0) AS inserido`,
            [curso.nome, curso.sigla, curso.coordenador, curso.semestres]
        );
        const cursoId = linha.rows[0].id;
        cursoPorNome.set(curso.nome, cursoId);
        if (linha.rows[0].inserido) resumo.cursos += 1;

        for (const nomeCampus of curso.campus) {
            await db.query(
                `INSERT INTO curso_campus (curso_id, campus_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [cursoId, exigirCampus(nomeCampus)]
            );
        }
    }

    // 2. Disciplinas e matriz curricular
    const disciplinaPorNome = new Map();
    for (const [nomeCurso, lista] of Object.entries(DISCIPLINAS)) {
        const cursoId = cursoPorNome.get(nomeCurso);

        for (const disciplina of lista) {
            const linha = await db.query(
                `INSERT INTO disciplinas (nome, codigo, carga_horaria, ativo)
                 VALUES ($1, $2, $3, TRUE)
                 ON CONFLICT (LOWER(codigo)) WHERE codigo IS NOT NULL DO UPDATE SET nome = EXCLUDED.nome
                 RETURNING id, (xmax = 0) AS inserido`,
                [disciplina.nome, disciplina.codigo, disciplina.carga]
            );
            const disciplinaId = linha.rows[0].id;
            disciplinaPorNome.set(disciplina.nome, disciplinaId);
            if (linha.rows[0].inserido) resumo.disciplinas += 1;

            await db.query(
                `INSERT INTO curso_disciplinas (curso_id, disciplina_id, semestre_sugerido, ativo)
                 VALUES ($1, $2, $3, TRUE)
                 ON CONFLICT (curso_id, disciplina_id) DO NOTHING`,
                [cursoId, disciplinaId, disciplina.semestre]
            );
        }
    }

    // 3. Professores
    const professorPorNome = new Map();
    for (const professor of PROFESSORES) {
        const linha = await db.query(
            `INSERT INTO professores (nome, email, ativo)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (LOWER(email)) WHERE email IS NOT NULL DO UPDATE SET nome = EXCLUDED.nome
             RETURNING id, (xmax = 0) AS inserido`,
            [professor.nome, professor.email]
        );
        professorPorNome.set(professor.nome, linha.rows[0].id);
        if (linha.rows[0].inserido) resumo.professores += 1;
    }

    // 4. Locais (chave: campus + nome)
    const localPorChave = new Map();
    for (const local of LOCAIS) {
        const campusId = exigirCampus(local.campus);
        const linha = await db.query(
            `INSERT INTO locais (campus_id, nome, codigo, tipo, capacidade, ativo)
             VALUES ($1, $2, $3, $4, $5, TRUE)
             ON CONFLICT (campus_id, nome) DO UPDATE SET tipo = EXCLUDED.tipo
             RETURNING id, (xmax = 0) AS inserido`,
            [campusId, local.nome, local.codigo, local.tipo, local.capacidade]
        );
        localPorChave.set(`${local.campus}|${local.nome}`, linha.rows[0].id);
        if (linha.rows[0].inserido) resumo.locais += 1;
    }

    // 5. Turmas
    const turmaPorCodigo = new Map();
    for (const turma of TURMAS) {
        const turno = turnoPorSlug.get(turma.turno);
        if (!turno) throw new Error(`Turno nao encontrado: ${turma.turno}`);

        const linha = await db.query(
            `INSERT INTO turmas (nome, codigo, periodo_letivo_id, campus_id, curso_id,
                                 semestre_curricular, turno_id, ativo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
             ON CONFLICT (periodo_letivo_id, LOWER(codigo)) WHERE codigo IS NOT NULL DO UPDATE SET nome = EXCLUDED.nome
             RETURNING id, (xmax = 0) AS inserido`,
            [
                turma.nome,
                turma.codigo,
                periodo.id,
                exigirCampus(turma.campus),
                cursoPorNome.get(turma.curso),
                turma.semestre,
                turno.id,
            ]
        );
        turmaPorCodigo.set(turma.codigo, { id: linha.rows[0].id, ...turma });
        if (linha.rows[0].inserido) resumo.turmas += 1;
    }

    // 6. Aulas — criadas pelo service, portanto validadas contra conflitos
    for (const [codigoTurma, grade] of Object.entries(GRADES)) {
        const turma = turmaPorCodigo.get(codigoTurma);
        const horarios = await db.query(
            `SELECT h.id, h.ordem FROM horarios_turno h
              JOIN turnos t ON t.id = h.turno_id
             WHERE t.slug = $1 AND h.ativo
             ORDER BY h.ordem`,
            [turma.turno]
        );
        const horarioPorOrdem = new Map(horarios.rows.map((linha) => [linha.ordem, linha.id]));

        for (const [dia, ordem, disciplina, professor, local, modalidade] of grade) {
            const horarioId = horarioPorOrdem.get(ordem);
            if (!horarioId) throw new Error(`Horario ${ordem} inexistente no turno ${turma.turno}`);

            const localId = local ? localPorChave.get(`${turma.campus}|${local}`) : null;
            if (local && !localId) throw new Error(`Local nao encontrado: ${local}`);

            await aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplinaPorNome.get(disciplina),
                professorId: professor ? professorPorNome.get(professor) : null,
                localId,
                diaSemana: dia,
                horarioTurnoId: horarioId,
                modalidade,
            });
            resumo.aulas += 1;
        }
    }

    // 7. Aulas sem horario (pendencias intencionais)
    for (const pendencia of PENDENCIAS) {
        const turma = turmaPorCodigo.get(pendencia.turma);
        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplinaPorNome.get(pendencia.disciplina),
            professorId: pendencia.professor ? professorPorNome.get(pendencia.professor) : null,
            localId: null,
            diaSemana: 5,
            horarioTurnoId: null,
            modalidade: 'presencial',
            observacao: 'Aguardando definicao de horario',
        });
        resumo.pendencias += 1;
    }

    // 8. Usuarios de demonstracao (coordenadores e NAP)
    for (const usuario of USUARIOS) {
        const hash = await gerarHash(usuario.senha);
        const linha = await db.query(
            `INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo)
             VALUES ($1, $2, $3, $4, TRUE)
             ON CONFLICT (LOWER(email)) DO UPDATE SET senha_hash = EXCLUDED.senha_hash
             RETURNING id, (xmax = 0) AS inserido`,
            [usuario.nome, usuario.email, hash, usuario.perfil]
        );
        const usuarioId = linha.rows[0].id;
        if (linha.rows[0].inserido) resumo.usuarios += 1;

        for (const nomeCurso of usuario.cursos) {
            await db.query(
                `INSERT INTO usuario_cursos (usuario_id, curso_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [usuarioId, cursoPorNome.get(nomeCurso)]
            );
        }

        for (const nomeCampus of usuario.campus) {
            await db.query(
                `INSERT INTO usuario_campus (usuario_id, campus_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [usuarioId, exigirCampus(nomeCampus)]
            );
        }
    }

    return { resumo, periodo: periodo.codigo };
};

// ---------------------------------------------------------------------------
// Remocao
// ---------------------------------------------------------------------------

const remover = async () => {
    const codigosTurma = TURMAS.map((turma) => turma.codigo);
    const codigosDisciplina = Object.values(DISCIPLINAS)
        .flat()
        .map((disciplina) => disciplina.codigo);
    const emailsProfessor = PROFESSORES.map((professor) => professor.email);
    const emailsUsuario = USUARIOS.map((usuario) => usuario.email);
    const nomesCurso = CURSOS.map((curso) => curso.nome);
    const chavesLocal = LOCAIS.map((local) => `${local.campus}|${local.nome}`);

    return db.transacao(async (cliente) => {
        const contar = (resultado) => resultado.rowCount;

        const aulas = contar(
            await cliente.query(
                `DELETE FROM aulas WHERE turma_id IN (SELECT id FROM turmas WHERE codigo = ANY($1))`,
                [codigosTurma]
            )
        );

        const turmas = contar(
            await cliente.query('DELETE FROM turmas WHERE codigo = ANY($1)', [codigosTurma])
        );

        await cliente.query(
            `DELETE FROM curso_disciplinas
              WHERE disciplina_id IN (SELECT id FROM disciplinas WHERE codigo = ANY($1))`,
            [codigosDisciplina]
        );

        const disciplinas = contar(
            await cliente.query('DELETE FROM disciplinas WHERE codigo = ANY($1)', [
                codigosDisciplina,
            ])
        );

        const professores = contar(
            await cliente.query('DELETE FROM professores WHERE LOWER(email) = ANY($1)', [
                emailsProfessor,
            ])
        );

        const locais = contar(
            await cliente.query(
                `DELETE FROM locais l
                  USING campus c
                  WHERE c.id = l.campus_id AND (c.nome || '|' || l.nome) = ANY($1)`,
                [chavesLocal]
            )
        );

        await cliente.query(
            `DELETE FROM usuario_cursos
              WHERE usuario_id IN (SELECT id FROM usuarios WHERE LOWER(email) = ANY($1))`,
            [emailsUsuario]
        );
        await cliente.query(
            `DELETE FROM usuario_campus
              WHERE usuario_id IN (SELECT id FROM usuarios WHERE LOWER(email) = ANY($1))`,
            [emailsUsuario]
        );

        const usuarios = contar(
            await cliente.query('DELETE FROM usuarios WHERE LOWER(email) = ANY($1)', [
                emailsUsuario,
            ])
        );

        await cliente.query(
            `DELETE FROM curso_campus WHERE curso_id IN (SELECT id FROM cursos WHERE nome = ANY($1))`,
            [nomesCurso]
        );

        const cursos = contar(
            await cliente.query('DELETE FROM cursos WHERE nome = ANY($1)', [nomesCurso])
        );

        return { aulas, turmas, disciplinas, professores, locais, usuarios, cursos };
    });
};

// ---------------------------------------------------------------------------

const principal = async () => {
    const comando = process.argv[2];

    if (comando === 'criar') {
        const { resumo, periodo } = await criar();
        console.log(`\nDados de exemplo criados no periodo letivo ${periodo}:\n`);
        console.log(`  cursos ....... ${resumo.cursos}`);
        console.log(`  disciplinas .. ${resumo.disciplinas}`);
        console.log(`  professores .. ${resumo.professores}`);
        console.log(`  locais ....... ${resumo.locais}`);
        console.log(`  turmas ....... ${resumo.turmas}`);
        console.log(`  aulas ........ ${resumo.aulas} (+${resumo.pendencias} sem horario)`);
        console.log(`  usuarios ..... ${resumo.usuarios}`);
        console.log('\nPara remover tudo: node scripts/dados-exemplo.js remover\n');
        return;
    }

    if (comando === 'remover') {
        const removidos = await remover();
        console.log('\nDados de exemplo removidos:\n');
        Object.entries(removidos).forEach(([chave, valor]) => {
            console.log(`  ${chave.padEnd(14)} ${valor}`);
        });
        console.log('');
        return;
    }

    console.error('Uso: node scripts/dados-exemplo.js criar|remover');
    process.exitCode = 1;
};

principal()
    .catch((erro) => {
        console.error(`\nErro: ${erro.message}`);
        if (erro.detalhes) console.error(JSON.stringify(erro.detalhes, null, 2));
        process.exitCode = 1;
    })
    .finally(() => db.encerrar());
