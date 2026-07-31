/**
 * Montador da grade horaria (`/admin/aulas`).
 *
 * O foco e a tela mais importante do painel: a matriz dias x horarios do turno
 * da turma. Os testes cobrem a renderizacao da matriz, todas as operacoes
 * (adicionar, editar, mover, copiar, remover, lote, pendencias), a exibicao dos
 * conflitos, o funcionamento SEM JavaScript e as restricoes de perfil (NAP so
 * altera o local; coordenador so opera turmas dos seus cursos).
 */
const bd = require('./helpers/db');
const { criarApp, criarAgente, login, tokenCsrf, extrairCsrfDoHtml } = require('./helpers/app');

let app;

/**
 * POST em formato de formulario com token CSRF.
 *
 * Nao usa `postComCsrf` do helper porque aqui e preciso repetir a MESMA chave
 * (`horario_turno_ids`) varias vezes — e assim que checkboxes chegam ao
 * servidor, que interpreta o corpo com `extended: false`.
 *
 * @param {object} agente
 * @param {string} caminho
 * @param {Record<string, any>} dados
 * @returns {Promise<import('supertest').Response>}
 */
const postar = async (agente, caminho, dados = {}) => {
    const token = await tokenCsrf(agente);
    const corpo = new URLSearchParams();

    Object.entries({ ...dados, _csrf: token }).forEach(([chave, valor]) => {
        if (valor === undefined || valor === null) return;
        if (Array.isArray(valor)) {
            valor.forEach((item) => corpo.append(chave, String(item)));
            return;
        }
        corpo.append(chave, String(valor));
    });

    return agente.post(caminho).type('form').send(corpo.toString());
};

/** Agente autenticado como administrador do seed. */
const agenteAdmin = async () => {
    const admin = await bd.usuarioAdmin();
    const agente = criarAgente(app);
    await login(agente, admin.email, admin.senha);
    return agente;
};

/** Agente autenticado com um usuario recem-criado. */
const agenteDe = async (usuario) => {
    const agente = criarAgente(app);
    await login(agente, usuario.email, usuario.senha);
    return agente;
};

/** Cenario padrao: campus, curso, turma matutina, disciplina, professor e sala. */
const cenario = async () => {
    const campus = await bd.criarCampus({ nome: 'Águas Claras', sigla: 'AC' });
    const curso = await bd.criarCurso({
        nome: 'Análise e Desenvolvimento',
        campusIds: [campus.id],
    });
    const turma = await bd.criarTurma({
        nome: 'ADS 2º semestre',
        codigo: 'ADS02',
        cursoId: curso.id,
        campusId: campus.id,
        turnoSlug: 'matutino',
    });
    const disciplina = await bd.criarDisciplina({ nome: 'Cálculo I', cursoId: curso.id });
    const professor = await bd.criarProfessor({ nome: 'João Silva' });
    const local = await bd.criarLocal({ campusId: campus.id, nome: '201 C', tipo: 'sala' });

    const horarios = [];
    for (let ordem = 1; ordem <= 5; ordem += 1) {
        horarios.push(await bd.horarioDoTurno('matutino', ordem));
    }

    return { campus, curso, turma, disciplina, professor, local, horarios };
};

/** Aulas gravadas de uma turma, em ordem previsivel. */
const aulasDaTurma = async (turmaId) => {
    const resultado = await bd.query(
        'SELECT * FROM aulas WHERE turma_id = $1 ORDER BY dia_semana, horario_turno_id NULLS LAST, id',
        [turmaId]
    );
    return resultado.rows;
};

beforeAll(() => {
    app = criarApp();
});

beforeEach(async () => {
    await bd.limparDados();
});

afterAll(async () => {
    await bd.encerrar();
});

// ---------------------------------------------------------------------------
// Renderizacao da matriz
// ---------------------------------------------------------------------------
describe('matriz da grade', () => {
    test('renderiza uma linha por horario do turno, com nome do periodo e faixa', async () => {
        const { turma } = await cenario();
        const agente = await agenteAdmin();

        const resposta = await agente.get(`/admin/aulas/turma/${turma.id}`);

        expect(resposta.status).toBe(200);

        // Turno matutino do seed: 5 periodos de 50 minutos.
        ['1º horário', '2º horário', '3º horário', '4º horário', '5º horário'].forEach((nome) => {
            expect(resposta.text).toContain(nome);
        });

        expect(resposta.text).toContain('07:10 às 08:00');
        expect(resposta.text).toContain('10:40 às 11:30');

        // Horario de outro turno nao pode aparecer.
        expect(resposta.text).not.toContain('18:10 às 19:00');
    });

    test('renderiza colunas de segunda a sabado', async () => {
        const { turma } = await cenario();
        const agente = await agenteAdmin();

        const resposta = await agente.get(`/admin/aulas/turma/${turma.id}`);

        [
            'Segunda-feira',
            'Terça-feira',
            'Quarta-feira',
            'Quinta-feira',
            'Sexta-feira',
            'Sábado',
        ].forEach((dia) => {
            expect(resposta.text).toContain(dia);
        });
    });

    test('celula com aula mostra disciplina, professor, local e modalidade', async () => {
        const { turma, disciplina, professor, local, horarios } = await cenario();
        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            localId: local.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();
        const resposta = await agente.get(`/admin/aulas/turma/${turma.id}`);

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Cálculo I');
        expect(resposta.text).toContain('João Silva');
        expect(resposta.text).toContain('Sala 201 C');
        expect(resposta.text).toContain('Presencial');

        // Rotulo acessivel completo da celula ocupada.
        expect(resposta.text).toContain(
            'Segunda-feira, 1º horário, 07:10 às 08:00 — Cálculo I, Prof. João Silva, Sala 201 C, Presencial'
        );
    });

    test('celula vazia e um alvo focavel com rotulo descritivo', async () => {
        const { turma, horarios } = await cenario();
        const agente = await agenteAdmin();

        const resposta = await agente.get(`/admin/aulas/turma/${turma.id}`);

        expect(resposta.text).toContain('Terça-feira, 2º horário, 08:00 às 08:50 — vazio');
        expect(resposta.text).toContain(
            `acao=nova&amp;dia_semana=2&amp;horario_turno_id=${horarios[1].id}`
        );
    });
});

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------
describe('criar aula', () => {
    test('grava a aula da celula escolhida', async () => {
        const { turma, disciplina, professor, local, horarios } = await cenario();
        const agente = await agenteAdmin();

        const resposta = await postar(agente, '/admin/aulas', {
            turma_id: turma.id,
            disciplina_id: disciplina.id,
            professor_id: professor.id,
            local_id: local.id,
            dia_semana: 3,
            horario_turno_id: horarios[0].id,
            modalidade: 'presencial',
        });

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toContain(`/admin/aulas/turma/${turma.id}`);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
        expect(aulas[0].dia_semana).toBe(3);
        expect(aulas[0].horario_turno_id).toBe(horarios[0].id);
        expect(aulas[0].local_id).toBe(local.id);
    });

    test('o formulario da pagina funciona sem JavaScript (POST direto grava)', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const agente = await agenteAdmin();

        // Exatamente o que o navegador faria: abre a celula vazia, le o token do
        // HTML e envia o formulario. Nenhum fetch, nenhum script.
        const pagina = await agente.get(
            `/admin/aulas/turma/${turma.id}?acao=nova&dia_semana=4&horario_turno_id=${horarios[2].id}`
        );

        expect(pagina.status).toBe(200);
        expect(pagina.text).toContain('action="/admin/aulas"');

        const token = extrairCsrfDoHtml(pagina.text);
        expect(token).not.toBe('');

        const corpo = new URLSearchParams({
            _csrf: token,
            turma_id: String(turma.id),
            disciplina_id: String(disciplina.id),
            professor_id: '',
            local_id: '',
            dia_semana: '4',
            horario_turno_id: String(horarios[2].id),
            modalidade: 'presencial',
            observacao: '',
        });

        const resposta = await agente.post('/admin/aulas').type('form').send(corpo.toString());

        expect(resposta.status).toBe(302);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
        expect(aulas[0].dia_semana).toBe(4);
        expect(aulas[0].horario_turno_id).toBe(horarios[2].id);
    });

    test('celula ja ocupada devolve o conflito de forma legivel e nao grava', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 2,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();

        const resposta = await postar(agente, '/admin/aulas', {
            turma_id: turma.id,
            disciplina_id: outra.id,
            dia_semana: 2,
            horario_turno_id: horarios[0].id,
            modalidade: 'presencial',
        });

        expect(resposta.status).toBe(409);
        expect(resposta.text).toContain('Verificação de conflitos');
        expect(resposta.text).toMatch(/já (possui|tem) aula/i);
        // O que o usuario preencheu continua na tela.
        expect(resposta.text).toContain(`value="${outra.id}" selected`);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
        expect(aulas[0].disciplina_id).toBe(disciplina.id);
    });
});

// ---------------------------------------------------------------------------
// Periodos consecutivos (lote)
// ---------------------------------------------------------------------------
describe('criacao em periodos consecutivos', () => {
    test('cria a mesma aula em N horarios seguidos', async () => {
        const { turma, disciplina, professor, horarios } = await cenario();
        const agente = await agenteAdmin();

        const resposta = await postar(agente, '/admin/aulas/lote', {
            turma_id: turma.id,
            disciplina_id: disciplina.id,
            professor_id: professor.id,
            dia_semana: 5,
            modalidade: 'presencial',
            horario_turno_ids: [horarios[0].id, horarios[1].id, horarios[2].id],
        });

        expect(resposta.status).toBe(302);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(3);
        expect(aulas.map((aula) => aula.horario_turno_id).sort()).toEqual(
            [horarios[0].id, horarios[1].id, horarios[2].id].sort()
        );
    });

    test('desfaz o lote inteiro quando um dos periodos conflita', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const ocupante = await bd.criarDisciplina({ nome: 'Banco de Dados' });

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: ocupante.id,
            diaSemana: 5,
            horarioTurnoId: horarios[2].id,
        });

        const agente = await agenteAdmin();

        const resposta = await postar(agente, '/admin/aulas/lote', {
            turma_id: turma.id,
            disciplina_id: disciplina.id,
            dia_semana: 5,
            modalidade: 'presencial',
            horario_turno_ids: [horarios[0].id, horarios[1].id, horarios[2].id],
        });

        expect(resposta.status).toBe(409);
        expect(resposta.text).toContain('Nenhuma aula foi criada');

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
        expect(aulas[0].disciplina_id).toBe(ocupante.id);
    });
});

// ---------------------------------------------------------------------------
// Mover, copiar, editar e remover
// ---------------------------------------------------------------------------
describe('operacoes sobre uma aula', () => {
    test('mover leva a aula para outro dia e horario', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();

        const resposta = await postar(agente, `/admin/aulas/${aula.id}/mover`, {
            dia_semana: 4,
            horario_turno_id: horarios[3].id,
        });

        expect(resposta.status).toBe(302);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
        expect(aulas[0].id).toBe(aula.id);
        expect(aulas[0].dia_semana).toBe(4);
        expect(aulas[0].horario_turno_id).toBe(horarios[3].id);
    });

    test('copiar cria uma segunda aula sem alterar a original', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();

        const resposta = await postar(agente, `/admin/aulas/${aula.id}/copiar`, {
            dia_semana: 6,
            horario_turno_id: horarios[1].id,
        });

        expect(resposta.status).toBe(302);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(2);
        expect(aulas.every((item) => item.disciplina_id === disciplina.id)).toBe(true);
        expect(aulas.some((item) => item.dia_semana === 6)).toBe(true);
    });

    test('editar troca a disciplina da celula', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const nova = await bd.criarDisciplina({ nome: 'Estrutura de Dados' });
        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();

        const resposta = await postar(agente, `/admin/aulas/${aula.id}`, {
            disciplina_id: nova.id,
            professor_id: '',
            local_id: '',
            dia_semana: 1,
            horario_turno_id: horarios[0].id,
            modalidade: 'ead',
            observacao: 'aula remota',
        });

        expect(resposta.status).toBe(302);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas[0].disciplina_id).toBe(nova.id);
        expect(aulas[0].modalidade).toBe('ead');
        expect(aulas[0].observacao).toBe('aula remota');
    });

    test('inativar mantem o registro e tira a aula da grade', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();
        const resposta = await postar(agente, `/admin/aulas/${aula.id}/inativar`);

        expect(resposta.status).toBe(302);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
        expect(aulas[0].ativo).toBe(false);

        // A matriz passa a nao ter nenhuma celula ocupada (a mensagem de sucesso
        // ainda cita a disciplina, por isso a checagem e pela celula).
        const matriz = await agente.get(`/admin/aulas/turma/${turma.id}`);
        expect(matriz.text).not.toContain('montador-celula-ocupada');
        expect(matriz.text).toContain('Segunda-feira, 1º horário, 07:10 às 08:00 — vazio');
    });

    test('remover apaga a aula', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();
        const resposta = await postar(agente, `/admin/aulas/${aula.id}/remover`);

        expect(resposta.status).toBe(302);
        expect(await aulasDaTurma(turma.id)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Pre-visualizacao de conflitos
// ---------------------------------------------------------------------------
describe('pre-visualizacao de conflitos', () => {
    test('POST /admin/aulas/prever devolve JSON com os conflitos', async () => {
        const { turma, disciplina, professor, horarios } = await cenario();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: 2,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();
        const token = await tokenCsrf(agente);

        const resposta = await agente
            .post('/admin/aulas/prever')
            .type('form')
            .set('Accept', 'application/json')
            .send(
                new URLSearchParams({
                    _csrf: token,
                    turma_id: String(turma.id),
                    disciplina_id: String(outra.id),
                    professor_id: String(professor.id),
                    dia_semana: '2',
                    horario_turno_id: String(horarios[0].id),
                    modalidade: 'presencial',
                }).toString()
            );

        expect(resposta.status).toBe(200);
        expect(Array.isArray(resposta.body.conflitos)).toBe(true);
        expect(resposta.body.conflitos.length).toBeGreaterThan(0);
        expect(resposta.body.conflitos.map((item) => item.tipo)).toContain('professor');
        expect(resposta.body.conflitos.map((item) => item.mensagem).join(' ')).toContain(
            'João Silva'
        );

        // Pre-visualizacao nao grava nada.
        expect(await aulasDaTurma(turma.id)).toHaveLength(1);
    });

    test('sem JavaScript, a previsao reexibe o formulario com os conflitos', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 2,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();

        const resposta = await postar(agente, '/admin/aulas/prever', {
            turma_id: turma.id,
            disciplina_id: outra.id,
            dia_semana: 2,
            horario_turno_id: horarios[0].id,
            modalidade: 'presencial',
        });

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Verificação de conflitos');
        expect(resposta.text).toContain('Nada foi gravado ainda');
        expect(await aulasDaTurma(turma.id)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Pendencias
// ---------------------------------------------------------------------------
describe('aulas sem horario', () => {
    test('aparecem no painel de pendencias e podem receber dia e horario', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: null,
        });

        const agente = await agenteAdmin();

        const pagina = await agente.get(`/admin/aulas/turma/${turma.id}`);
        expect(pagina.status).toBe(200);
        expect(pagina.text).toContain('Aulas sem horário');
        expect(pagina.text).toContain(`/admin/aulas/${aula.id}/mover`);

        const resposta = await postar(agente, `/admin/aulas/${aula.id}/mover`, {
            dia_semana: 3,
            horario_turno_id: horarios[1].id,
        });

        expect(resposta.status).toBe(302);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas[0].dia_semana).toBe(3);
        expect(aulas[0].horario_turno_id).toBe(horarios[1].id);
    });

    test('a listagem filtra as aulas sem horario', async () => {
        const { turma, disciplina, horarios } = await cenario();
        const semHorario = await bd.criarDisciplina({ nome: 'Metodologia Científica' });

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });
        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: semHorario.id,
            diaSemana: 1,
            horarioTurnoId: null,
        });

        const agente = await agenteAdmin();
        const resposta = await agente.get('/admin/aulas?sem_horario=1');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Metodologia Científica');
        expect(resposta.text).not.toContain('Cálculo I');
    });
});

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------
describe('perfil NAP', () => {
    test('altera apenas o local: trocar a disciplina nao muda o registro', async () => {
        const { campus, turma, disciplina, local, horarios } = await cenario();
        const outroLocal = await bd.criarLocal({
            campusId: campus.id,
            nome: '305 B',
            tipo: 'laboratorio',
        });
        const outraDisciplina = await bd.criarDisciplina({ nome: 'Redes' });

        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            localId: local.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const nap = await bd.criarUsuario({ perfil: 'nap', campusIds: [campus.id] });
        const agente = await agenteDe(nap);

        const resposta = await postar(agente, `/admin/aulas/${aula.id}`, {
            local_id: outroLocal.id,
            modalidade: 'presencial',
            // Campos que o NAP nao pode alterar: enviados de proposito.
            disciplina_id: outraDisciplina.id,
            professor_id: '',
            dia_semana: 6,
            horario_turno_id: horarios[4].id,
            observacao: 'tentativa',
        });

        expect(resposta.status).toBe(302);

        const [gravada] = await aulasDaTurma(turma.id);
        expect(gravada.local_id).toBe(outroLocal.id);
        expect(gravada.disciplina_id).toBe(disciplina.id);
        expect(gravada.dia_semana).toBe(1);
        expect(gravada.horario_turno_id).toBe(horarios[0].id);
        expect(gravada.observacao).toBeNull();
    });

    test('recebe 403 ao criar, mover ou remover', async () => {
        const { campus, turma, disciplina, horarios } = await cenario();
        const aula = await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: 1,
            horarioTurnoId: horarios[0].id,
        });

        const nap = await bd.criarUsuario({ perfil: 'nap', campusIds: [campus.id] });
        const agente = await agenteDe(nap);

        const criacao = await postar(agente, '/admin/aulas', {
            turma_id: turma.id,
            disciplina_id: disciplina.id,
            dia_semana: 2,
            horario_turno_id: horarios[1].id,
            modalidade: 'presencial',
        });
        expect(criacao.status).toBe(403);

        const movimento = await postar(agente, `/admin/aulas/${aula.id}/mover`, {
            dia_semana: 2,
            horario_turno_id: horarios[1].id,
        });
        expect(movimento.status).toBe(403);

        const exclusao = await postar(agente, `/admin/aulas/${aula.id}/remover`);
        expect(exclusao.status).toBe(403);

        const aulas = await aulasDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
        expect(aulas[0].dia_semana).toBe(1);
    });
});

describe('perfil coordenador', () => {
    test('recebe 403 no montador de uma turma de outro curso', async () => {
        const { campus, turma } = await cenario();
        const outroCurso = await bd.criarCurso({ nome: 'Enfermagem', campusIds: [campus.id] });

        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            cursosIds: [outroCurso.id],
        });
        const agente = await agenteDe(coordenador);

        const resposta = await agente.get(`/admin/aulas/turma/${turma.id}`);

        expect(resposta.status).toBe(403);
    });

    test('monta a grade das turmas do proprio curso', async () => {
        const { curso, turma, disciplina, horarios } = await cenario();

        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            cursosIds: [curso.id],
        });
        const agente = await agenteDe(coordenador);

        const pagina = await agente.get(`/admin/aulas/turma/${turma.id}`);
        expect(pagina.status).toBe(200);

        const resposta = await postar(agente, '/admin/aulas', {
            turma_id: turma.id,
            disciplina_id: disciplina.id,
            dia_semana: 2,
            horario_turno_id: horarios[1].id,
            modalidade: 'presencial',
        });

        expect(resposta.status).toBe(302);
        expect(await aulasDaTurma(turma.id)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Listagem e selecao de turma
// ---------------------------------------------------------------------------
describe('listagem de aulas', () => {
    test('lista as aulas com filtros e leva ao montador da turma', async () => {
        const { turma, disciplina, professor, horarios } = await cenario();
        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: 2,
            horarioTurnoId: horarios[0].id,
        });

        const agente = await agenteAdmin();
        const resposta = await agente.get(`/admin/aulas?turma_id=${turma.id}&dia=2`);

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Cálculo I');
        expect(resposta.text).toContain(`/admin/aulas/turma/${turma.id}`);
    });

    test('a escolha de turma lista as turmas do escopo', async () => {
        const { turma } = await cenario();

        const agente = await agenteAdmin();
        const resposta = await agente.get('/admin/aulas/turma');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('ADS 2º semestre');
        expect(resposta.text).toContain(`/admin/aulas/turma/${turma.id}`);
    });
});
