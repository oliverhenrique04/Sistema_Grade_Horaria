/**
 * Utilitarios de banco para os testes automatizados.
 *
 * Todos os testes compartilham o schema recriado uma unica vez pelo
 * `tests/setup/global-setup.js` (migrations + seed). Cada arquivo de teste
 * deve comecar limpando os dados:
 *
 *     const bd = require('./helpers/db');
 *
 *     beforeEach(async () => { await bd.limparDados(); });
 *     afterAll(async () => { await bd.encerrar(); });
 *
 * Apos `limparDados()` o banco contem apenas a carga do seed que NAO e dado de
 * teste: turnos, horarios_turno, periodos_letivos e o usuario administrador.
 * Campus, cursos, disciplinas, professores, locais, turmas e aulas ficam
 * vazios, com as sequencias reiniciadas (ids previsiveis a partir de 1).
 *
 * Todos os `criar*` aceitam um objeto de opcoes com valores padrao sensatos e
 * criam automaticamente as dependencias obrigatorias que faltarem, de modo que
 * um teste possa escrever apenas `await bd.criarTurma()`.
 */
const config = require('../../src/config/env');
const db = require('../../src/config/db');
const autenticacaoService = require('../../src/services/autenticacaoService');

/** Contador monotonico usado para gerar nomes/e-mails unicos. */
let sequencia = 0;
const proximo = () => {
    sequencia += 1;
    return sequencia;
};

/** Tabelas de dados esvaziadas a cada teste (a ordem nao importa: TRUNCATE unico). */
const TABELAS_DE_DADOS = [
    'importacoes',
    'aula_professores',
    'aulas',
    'turmas',
    'curso_disciplinas',
    'curso_campus',
    'usuario_cursos',
    'usuario_campus',
    'locais',
    'disciplinas',
    'professores',
    'cursos',
    'campus',
];

/**
 * Executa SQL arbitrario no banco de teste.
 * @param {string} sql
 * @param {any[]} [parametros]
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = (sql, parametros) => db.query(sql, parametros);

/**
 * Esvazia as tabelas de dados preservando a carga estrutural do seed
 * (turnos, horarios_turno, periodos_letivos) e o usuario administrador.
 * @returns {Promise<void>}
 */
const limparDados = async () => {
    await db.query(`TRUNCATE TABLE ${TABELAS_DE_DADOS.join(', ')} RESTART IDENTITY CASCADE`);
    await db.query('DELETE FROM usuarios WHERE LOWER(email) <> LOWER($1)', [config.admin.email]);
};

/**
 * Remove todas as sessoes gravadas (equivale a deslogar todo mundo).
 * @returns {Promise<void>}
 */
const limparSessoes = () => db.query('DELETE FROM session');

/**
 * Fecha o pool de conexoes. Chamar em `afterAll` de cada arquivo de teste.
 * @returns {Promise<void>}
 */
const encerrar = async () => {
    try {
        await db.encerrar();
    } catch {
        // Pool ja encerrado.
    }
};

const primeiraLinha = (resultado) => resultado.rows[0];

// ---------------------------------------------------------------------------
// Consultas de apoio a carga estrutural do seed
// ---------------------------------------------------------------------------

/**
 * Turno do seed pelo slug ('matutino', 'vespertino', 'integral', 'noturno').
 * @param {string} [slug='matutino']
 * @returns {Promise<object>}
 */
const turnoPorSlug = async (slug = 'matutino') => {
    const resultado = await db.query('SELECT * FROM turnos WHERE slug = $1', [slug]);
    if (resultado.rowCount === 0) throw new Error(`Turno nao encontrado no seed: ${slug}`);
    return primeiraLinha(resultado);
};

/**
 * Horario de um turno pela ordem (1 = primeiro periodo do dia).
 * @param {string} [slug='matutino'] slug do turno
 * @param {number} [ordem=1] posicao do periodo dentro do turno
 * @returns {Promise<object>} linha de `horarios_turno`
 */
const horarioDoTurno = async (slug = 'matutino', ordem = 1) => {
    const resultado = await db.query(
        `SELECT h.*
           FROM horarios_turno h
           JOIN turnos t ON t.id = h.turno_id
          WHERE t.slug = $1 AND h.ordem = $2`,
        [slug, ordem]
    );
    if (resultado.rowCount === 0) {
        throw new Error(`Horario nao encontrado: turno ${slug}, ordem ${ordem}`);
    }
    return primeiraLinha(resultado);
};

/**
 * Periodo letivo marcado como atual pelo seed.
 * @returns {Promise<object>}
 */
const periodoAtual = async () => {
    const resultado = await db.query(
        'SELECT * FROM periodos_letivos WHERE atual ORDER BY id LIMIT 1'
    );
    if (resultado.rowCount === 0) throw new Error('Nenhum periodo letivo atual no seed.');
    return primeiraLinha(resultado);
};

/**
 * Usuario administrador criado pelo seed (perfil admin, senha de `.env.test`).
 * @returns {Promise<object & {senha:string}>}
 */
const usuarioAdmin = async () => {
    const resultado = await db.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [
        config.admin.email,
    ]);
    if (resultado.rowCount === 0) throw new Error('Administrador do seed nao encontrado.');
    return { ...primeiraLinha(resultado), senha: config.admin.senha };
};

// ---------------------------------------------------------------------------
// Fabricas de dados
// ---------------------------------------------------------------------------

/**
 * Cria um campus.
 * @param {{nome?:string, sigla?:string, ativo?:boolean}} [opcoes]
 * @returns {Promise<object>} linha de `campus`
 */
const criarCampus = async ({ nome, sigla, ativo = true } = {}) => {
    const indice = proximo();
    const resultado = await db.query(
        `INSERT INTO campus (nome, sigla, ativo) VALUES ($1, $2, $3) RETURNING *`,
        [nome || `Campus Teste ${indice}`, sigla || `CT${indice}`, ativo]
    );
    return primeiraLinha(resultado);
};

/**
 * Cria um curso e, opcionalmente, o vincula a campus.
 * @param {{nome?:string, sigla?:string, coordenador?:string, semestresTotal?:number,
 *          ativo?:boolean, campusIds?:number[]}} [opcoes]
 * @returns {Promise<object>} linha de `cursos` com `campusIds`
 */
const criarCurso = async ({
    nome,
    sigla,
    coordenador = null,
    semestresTotal = 8,
    ativo = true,
    campusIds = [],
} = {}) => {
    const indice = proximo();
    const resultado = await db.query(
        `INSERT INTO cursos (nome, sigla, coordenador, semestres_total, ativo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
            nome || `Curso Teste ${indice}`,
            sigla || `CS${indice}`,
            coordenador,
            semestresTotal,
            ativo,
        ]
    );

    const curso = primeiraLinha(resultado);

    for (const campusId of campusIds) {
        await db.query(
            `INSERT INTO curso_campus (curso_id, campus_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [curso.id, campusId]
        );
    }

    return { ...curso, campusIds: [...campusIds] };
};

/**
 * Cria um usuario com senha em bcrypt e vinculos de escopo.
 *
 * A senha em texto puro volta no objeto (campo `senha`) apenas para que o teste
 * possa fazer login; no banco fica somente o hash.
 *
 * @param {{nome?:string, email?:string, senha?:string,
 *          perfil?:'admin'|'coordenador'|'nap', ativo?:boolean,
 *          cursosIds?:number[], campusIds?:number[]}} [opcoes]
 * @returns {Promise<object & {senha:string, cursosIds:number[], campusIds:number[]}>}
 */
const criarUsuario = async ({
    nome,
    email,
    senha = 'SenhaTeste@123',
    perfil = 'coordenador',
    ativo = true,
    cursosIds = [],
    campusIds = [],
} = {}) => {
    const indice = proximo();
    const senhaHash = await autenticacaoService.gerarHash(senha);

    const resultado = await db.query(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nome, email, perfil, ativo, ultimo_login_em, criado_em`,
        [
            nome || `Usuário Teste ${indice}`,
            (email || `usuario.teste.${indice}@teste.local`).toLowerCase(),
            senhaHash,
            perfil,
            ativo,
        ]
    );

    const usuario = primeiraLinha(resultado);

    for (const cursoId of cursosIds) {
        await db.query(
            'INSERT INTO usuario_cursos (usuario_id, curso_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [usuario.id, cursoId]
        );
    }

    for (const campusId of campusIds) {
        await db.query(
            'INSERT INTO usuario_campus (usuario_id, campus_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [usuario.id, campusId]
        );
    }

    return { ...usuario, senha, cursosIds: [...cursosIds], campusIds: [...campusIds] };
};

/**
 * Cria uma disciplina e, quando `cursoId` e informado, a vincula a matriz do curso.
 * @param {{nome?:string, codigo?:string, cargaHoraria?:number, ativo?:boolean,
 *          cursoId?:number, semestreSugerido?:number}} [opcoes]
 * @returns {Promise<object>} linha de `disciplinas`
 */
const criarDisciplina = async ({
    nome,
    codigo,
    cargaHoraria = 60,
    ativo = true,
    cursoId = null,
    semestreSugerido = null,
} = {}) => {
    const indice = proximo();
    const resultado = await db.query(
        `INSERT INTO disciplinas (nome, codigo, carga_horaria, ativo)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [nome || `Disciplina Teste ${indice}`, codigo || `DISC${indice}`, cargaHoraria, ativo]
    );

    const disciplina = primeiraLinha(resultado);

    if (cursoId) {
        await db.query(
            `INSERT INTO curso_disciplinas (curso_id, disciplina_id, semestre_sugerido)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [cursoId, disciplina.id, semestreSugerido]
        );
    }

    return disciplina;
};

/**
 * Cria um professor.
 * @param {{nome?:string, email?:string, ativo?:boolean}} [opcoes]
 * @returns {Promise<object>} linha de `professores`
 */
const criarProfessor = async ({ nome, email, ativo = true } = {}) => {
    const indice = proximo();
    const resultado = await db.query(
        `INSERT INTO professores (nome, email, ativo) VALUES ($1, $2, $3) RETURNING *`,
        [nome || `Professor Teste ${indice}`, email || `professor.${indice}@teste.local`, ativo]
    );
    return primeiraLinha(resultado);
};

/**
 * Cria um local (sala). O campus e criado automaticamente quando omitido.
 * @param {{campusId?:number, nome?:string, codigo?:string, tipo?:string,
 *          capacidade?:number, ativo?:boolean}} [opcoes]
 * @returns {Promise<object>} linha de `locais`
 */
const criarLocal = async ({
    campusId,
    nome,
    codigo,
    tipo = 'sala',
    capacidade = 40,
    ativo = true,
} = {}) => {
    const indice = proximo();
    const campus = campusId || (await criarCampus()).id;

    const resultado = await db.query(
        `INSERT INTO locais (campus_id, nome, codigo, tipo, capacidade, ativo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [campus, nome || `Sala ${indice}`, codigo || `S${indice}`, tipo, capacidade, ativo]
    );
    return primeiraLinha(resultado);
};

/**
 * Cria uma turma, gerando curso, campus, turno e periodo letivo quando omitidos.
 * @param {{nome?:string, codigo?:string, cursoId?:number, campusId?:number,
 *          turnoId?:number, turnoSlug?:string, periodoLetivoId?:number,
 *          semestreCurricular?:number, ativo?:boolean}} [opcoes]
 * @returns {Promise<object>} linha de `turmas`
 */
const criarTurma = async ({
    nome,
    codigo,
    cursoId,
    campusId,
    turnoId,
    turnoSlug = 'matutino',
    periodoLetivoId,
    semestreCurricular = 1,
    ativo = true,
} = {}) => {
    const indice = proximo();
    const campus = campusId || (await criarCampus()).id;
    const curso = cursoId || (await criarCurso({ campusIds: [campus] })).id;
    const turno = turnoId || (await turnoPorSlug(turnoSlug)).id;
    const periodo = periodoLetivoId || (await periodoAtual()).id;

    const resultado = await db.query(
        `INSERT INTO turmas
            (nome, codigo, periodo_letivo_id, campus_id, curso_id, semestre_curricular, turno_id, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
            nome || `Turma Teste ${indice}`,
            codigo || `T${indice}`,
            periodo,
            campus,
            curso,
            semestreCurricular,
            turno,
            ativo,
        ]
    );
    return primeiraLinha(resultado);
};

/**
 * Cria uma aula na grade de uma turma. Turma, disciplina e horario sao criados
 * automaticamente quando omitidos (o horario segue o turno da turma).
 * @param {{turmaId?:number, disciplinaId?:number, professorId?:number|null,
 *          localId?:number|null, diaSemana?:number, horarioTurnoId?:number|null,
 *          ordemHorario?:number, modalidade?:string, observacao?:string|null,
 *          ativo?:boolean}} [opcoes]
 * @returns {Promise<object>} linha de `aulas`
 */
const criarAula = async ({
    turmaId,
    disciplinaId,
    professorId = null,
    localId = null,
    diaSemana = 1,
    horarioTurnoId,
    ordemHorario = 1,
    modalidade = 'presencial',
    observacao = null,
    ativo = true,
} = {}) => {
    const turma = turmaId || (await criarTurma()).id;
    const disciplina = disciplinaId || (await criarDisciplina()).id;

    let horario = horarioTurnoId;
    if (horario === undefined) {
        const linha = await db.query(
            `SELECT h.id
               FROM horarios_turno h
               JOIN turmas t ON t.turno_id = h.turno_id
              WHERE t.id = $1 AND h.ordem = $2`,
            [turma, ordemHorario]
        );
        horario = linha.rowCount > 0 ? linha.rows[0].id : null;
    }

    const resultado = await db.query(
        `INSERT INTO aulas
            (turma_id, disciplina_id, professor_id, local_id, dia_semana, horario_turno_id,
             modalidade, observacao, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [turma, disciplina, professorId, localId, diaSemana, horario, modalidade, observacao, ativo]
    );
    return primeiraLinha(resultado);
};

module.exports = {
    query,
    limparDados,
    limparSessoes,
    encerrar,
    turnoPorSlug,
    horarioDoTurno,
    periodoAtual,
    usuarioAdmin,
    criarCampus,
    criarCurso,
    criarUsuario,
    criarDisciplina,
    criarProfessor,
    criarLocal,
    criarTurma,
    criarAula,
};
