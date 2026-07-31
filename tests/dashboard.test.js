/**
 * Testes do painel administrativo (dashboard).
 *
 * Cobrem os indicadores por perfil (admin global, coordenador por curso, nap por
 * campus), as pendencias detectadas na grade, o estado de escopo vazio, o
 * periodo letivo vindo do banco e o bloqueio de acesso sem sessao.
 *
 * Executar com schema isolado:
 *   NODE_ENV=test DB_SCHEMA=teste_painel npx jest tests/dashboard.test.js --runInBand
 */
const bd = require('./helpers/db');
const { criarApp, criarAgente, login } = require('./helpers/app');

const SENHA = 'SenhaTeste@123';

let app;

// ---------------------------------------------------------------------------
// Leitura do HTML renderizado
// ---------------------------------------------------------------------------

/**
 * Valor de um cartao de indicador (atributo `data-valor`).
 * @param {string} html
 * @param {string} chave valor de `data-indicador`
 * @returns {number|null} null quando o cartao nao foi renderizado
 */
const valorIndicador = (html, chave) => {
    const encontrado = new RegExp(`data-indicador="${chave}" data-valor="(\\d+)"`).exec(html);
    return encontrado ? Number(encontrado[1]) : null;
};

/**
 * Total de ocorrencias da secao de pendencias.
 * @param {string} html
 * @returns {number|null}
 */
const totalPendencias = (html) => {
    const encontrado = /data-pendencias="(\d+)"/.exec(html);
    return encontrado ? Number(encontrado[1]) : null;
};

/**
 * Total de um tipo especifico de pendencia.
 * @param {string} html
 * @param {string} tipo
 * @returns {number} zero quando o grupo nao aparece
 */
const totalPendenciaTipo = (html, tipo) => {
    const encontrado = new RegExp(`data-pendencia="${tipo}" data-total="(\\d+)"`).exec(html);
    return encontrado ? Number(encontrado[1]) : 0;
};

/**
 * Codigo do periodo letivo em destaque.
 * @param {string} html
 * @returns {string|null}
 */
const periodoEmDestaque = (html) => {
    const encontrado = /data-periodo-atual="([^"]+)"/.exec(html);
    return encontrado ? encontrado[1] : null;
};

/**
 * Turmas e aulas de um turno na tabela de distribuicao.
 * @param {string} html
 * @param {string} slug
 * @returns {{turmas:number, aulas:number}|null}
 */
const linhaDoTurno = (html, slug) => {
    const bloco = new RegExp(`data-turno="${slug}"([\\s\\S]*?)</tr>`).exec(html);
    if (!bloco) return null;

    const numeros = [...bloco[1].matchAll(/text-end">(\d+)</g)].map((par) => Number(par[1]));
    if (numeros.length < 2) return null;

    return { turmas: numeros[0], aulas: numeros[1] };
};

/**
 * Abre o painel com um usuario autenticado.
 * @param {{email:string, senha?:string}} usuario
 * @returns {Promise<import('supertest').Response>}
 */
const abrirPainel = async (usuario) => {
    const agente = criarAgente(app);
    await login(agente, usuario.email, usuario.senha || SENHA);
    return agente.get('/admin');
};

// ---------------------------------------------------------------------------
// Cenario compartilhado de escopo
// ---------------------------------------------------------------------------

/**
 * Dois campus, dois cursos, uma turma e uma aula completa em cada, com
 * professores, disciplinas e locais distintos. Permite verificar que cada
 * perfil enxerga apenas a sua metade.
 */
const montarCenarioDeEscopo = async () => {
    const campusA = await bd.criarCampus({ nome: 'Campus Alfa', sigla: 'ALF' });
    const campusB = await bd.criarCampus({ nome: 'Campus Beta', sigla: 'BET' });

    const cursoA = await bd.criarCurso({ nome: 'Curso Alfa', campusIds: [campusA.id] });
    const cursoB = await bd.criarCurso({ nome: 'Curso Beta', campusIds: [campusB.id] });

    const turmaA = await bd.criarTurma({
        nome: 'Turma Alfa',
        cursoId: cursoA.id,
        campusId: campusA.id,
        turnoSlug: 'matutino',
    });
    const turmaB = await bd.criarTurma({
        nome: 'Turma Beta',
        cursoId: cursoB.id,
        campusId: campusB.id,
        turnoSlug: 'noturno',
    });

    const professorA = await bd.criarProfessor({ nome: 'Professor Alfa' });
    const professorB = await bd.criarProfessor({ nome: 'Professor Beta' });
    const disciplinaA = await bd.criarDisciplina({ nome: 'Disciplina Alfa', cursoId: cursoA.id });
    const disciplinaB = await bd.criarDisciplina({ nome: 'Disciplina Beta', cursoId: cursoB.id });
    const localA = await bd.criarLocal({ campusId: campusA.id, nome: 'Sala Alfa' });
    const localB = await bd.criarLocal({ campusId: campusB.id, nome: 'Sala Beta' });

    await bd.criarAula({
        turmaId: turmaA.id,
        disciplinaId: disciplinaA.id,
        professorId: professorA.id,
        localId: localA.id,
        diaSemana: 1,
        ordemHorario: 1,
    });
    await bd.criarAula({
        turmaId: turmaB.id,
        disciplinaId: disciplinaB.id,
        professorId: professorB.id,
        localId: localB.id,
        diaSemana: 1,
        ordemHorario: 1,
    });

    return {
        campusA,
        campusB,
        cursoA,
        cursoB,
        turmaA,
        turmaB,
        professorA,
        professorB,
        disciplinaA,
        disciplinaB,
        localA,
        localB,
    };
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

describe('acesso ao painel', () => {
    test('usuario nao autenticado e redirecionado para /login', async () => {
        const agente = criarAgente(app);
        const resposta = await agente.get('/admin');

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toContain('/login');
    });

    test('responde 200 para admin, coordenador e nap', async () => {
        const cenario = await montarCenarioDeEscopo();

        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            senha: SENHA,
            cursosIds: [cenario.cursoA.id],
        });
        const nap = await bd.criarUsuario({
            perfil: 'nap',
            senha: SENHA,
            campusIds: [cenario.campusA.id],
        });

        for (const usuario of [admin, coordenador, nap]) {
            const resposta = await abrirPainel(usuario);

            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain('Indicadores');
            expect(resposta.text).toContain('Distribuição por turno');
            // O documento saiu inteiro (layout de inicio + fim).
            expect(resposta.text).toContain('</html>');
        }
    });

    test('os cartoes clicaveis apontam para as listagens com o BASE_PATH aplicado', async () => {
        await montarCenarioDeEscopo();
        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });

        const resposta = await abrirPainel(admin);

        // Sem BASE_PATH no ambiente de teste os links ficam na raiz.
        expect(resposta.text).toContain('href="/admin/turmas"');
        expect(resposta.text).toContain('href="/admin/cursos"');
        expect(resposta.text).toContain('href="/admin/locais"');
    });
});

describe('indicadores por escopo', () => {
    test('as contagens do admin sao globais', async () => {
        await montarCenarioDeEscopo();
        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });

        const resposta = await abrirPainel(admin);

        expect(resposta.status).toBe(200);
        expect(valorIndicador(resposta.text, 'turmas')).toBe(2);
        expect(valorIndicador(resposta.text, 'aulas')).toBe(2);
        expect(valorIndicador(resposta.text, 'cursos')).toBe(2);
        expect(valorIndicador(resposta.text, 'professores')).toBe(2);
        expect(valorIndicador(resposta.text, 'disciplinas')).toBe(2);
        expect(valorIndicador(resposta.text, 'locais')).toBe(2);

        // A distribuicao por turno acompanha o mesmo escopo.
        expect(linhaDoTurno(resposta.text, 'matutino')).toEqual({ turmas: 1, aulas: 1 });
        expect(linhaDoTurno(resposta.text, 'noturno')).toEqual({ turmas: 1, aulas: 1 });
    });

    test('coordenador so ve os numeros dos seus cursos', async () => {
        const cenario = await montarCenarioDeEscopo();
        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            senha: SENHA,
            cursosIds: [cenario.cursoA.id],
        });

        const resposta = await abrirPainel(coordenador);

        expect(resposta.status).toBe(200);
        expect(valorIndicador(resposta.text, 'turmas')).toBe(1);
        expect(valorIndicador(resposta.text, 'aulas')).toBe(1);
        expect(valorIndicador(resposta.text, 'cursos')).toBe(1);
        // Professores e disciplinas: apenas os presentes nas aulas do escopo.
        expect(valorIndicador(resposta.text, 'professores')).toBe(1);
        expect(valorIndicador(resposta.text, 'disciplinas')).toBe(1);
        expect(valorIndicador(resposta.text, 'locais')).toBe(1);

        // A turma do outro curso nao aparece em lugar nenhum da pagina.
        expect(resposta.text).not.toContain('Turma Beta');
        expect(linhaDoTurno(resposta.text, 'matutino')).toEqual({ turmas: 1, aulas: 1 });
        expect(linhaDoTurno(resposta.text, 'noturno')).toEqual({ turmas: 0, aulas: 0 });
    });

    test('nap so ve os numeros dos seus campus', async () => {
        const cenario = await montarCenarioDeEscopo();
        // Uma sala extra no campus dele, sem aulas: o NAP cuida dos locais.
        await bd.criarLocal({ campusId: cenario.campusA.id, nome: 'Laboratório Alfa' });

        const nap = await bd.criarUsuario({
            perfil: 'nap',
            senha: SENHA,
            campusIds: [cenario.campusA.id],
        });

        const resposta = await abrirPainel(nap);

        expect(resposta.status).toBe(200);
        expect(valorIndicador(resposta.text, 'turmas')).toBe(1);
        expect(valorIndicador(resposta.text, 'aulas')).toBe(1);
        expect(valorIndicador(resposta.text, 'cursos')).toBe(1);
        expect(valorIndicador(resposta.text, 'professores')).toBe(1);
        expect(valorIndicador(resposta.text, 'disciplinas')).toBe(1);
        // Todos os locais ativos dos campus vinculados, com ou sem aula.
        expect(valorIndicador(resposta.text, 'locais')).toBe(2);

        expect(resposta.text).not.toContain('Turma Beta');
        expect(linhaDoTurno(resposta.text, 'noturno')).toEqual({ turmas: 0, aulas: 0 });
    });

    test('usuario sem vinculo ve zeros e o estado vazio explicativo', async () => {
        await montarCenarioDeEscopo();

        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            senha: SENHA,
            cursosIds: [],
        });
        const nap = await bd.criarUsuario({ perfil: 'nap', senha: SENHA, campusIds: [] });

        const respostaCoordenador = await abrirPainel(coordenador);
        expect(respostaCoordenador.status).toBe(200);
        expect(respostaCoordenador.text).toContain('Nenhum curso vinculado ao seu usuário');
        ['turmas', 'aulas', 'cursos', 'professores', 'disciplinas', 'locais'].forEach((chave) => {
            expect(valorIndicador(respostaCoordenador.text, chave)).toBe(0);
        });
        expect(totalPendencias(respostaCoordenador.text)).toBe(0);

        const respostaNap = await abrirPainel(nap);
        expect(respostaNap.status).toBe(200);
        expect(respostaNap.text).toContain('Nenhum campus vinculado ao seu usuário');
        ['turmas', 'aulas', 'cursos', 'locais'].forEach((chave) => {
            expect(valorIndicador(respostaNap.text, chave)).toBe(0);
        });
    });
});

describe('pendencias da grade', () => {
    test('conta aulas sem horario e aulas sem local', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turma = await bd.criarTurma({ cursoId: curso.id, campusId: campus.id });
        const local = await bd.criarLocal({ campusId: campus.id });

        // Completa: nao e pendencia.
        await bd.criarAula({ turmaId: turma.id, localId: local.id, diaSemana: 1, ordemHorario: 1 });
        // Sem horario (mas com local).
        await bd.criarAula({
            turmaId: turma.id,
            localId: local.id,
            diaSemana: 2,
            horarioTurnoId: null,
        });
        // Sem local (mas com horario).
        await bd.criarAula({ turmaId: turma.id, localId: null, diaSemana: 3, ordemHorario: 1 });
        // EAD sem local: normal, nao conta como pendencia de local.
        await bd.criarAula({
            turmaId: turma.id,
            localId: null,
            diaSemana: 4,
            ordemHorario: 1,
            modalidade: 'ead',
        });
        // Inativa: fora de todas as contagens.
        await bd.criarAula({
            turmaId: turma.id,
            localId: null,
            diaSemana: 5,
            horarioTurnoId: null,
            ativo: false,
        });

        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const resposta = await abrirPainel(admin);

        expect(valorIndicador(resposta.text, 'aulas')).toBe(4);
        expect(valorIndicador(resposta.text, 'aulas_sem_horario')).toBe(1);
        expect(valorIndicador(resposta.text, 'aulas_sem_local')).toBe(1);

        expect(totalPendenciaTipo(resposta.text, 'aula_sem_horario')).toBe(1);
        expect(totalPendenciaTipo(resposta.text, 'aula_sem_local')).toBe(1);
        expect(totalPendencias(resposta.text)).toBe(2);
    });

    test('conflito de professor gravado direto no banco aparece nas pendencias', async () => {
        const campus = await bd.criarCampus();
        const cursoA = await bd.criarCurso({ nome: 'Curso Conflito A', campusIds: [campus.id] });
        const cursoB = await bd.criarCurso({ nome: 'Curso Conflito B', campusIds: [campus.id] });

        const turmaA = await bd.criarTurma({
            nome: 'Turma Conflito A',
            cursoId: cursoA.id,
            campusId: campus.id,
            turnoSlug: 'matutino',
        });
        const turmaB = await bd.criarTurma({
            nome: 'Turma Conflito B',
            cursoId: cursoB.id,
            campusId: campus.id,
            turnoSlug: 'matutino',
        });

        const professor = await bd.criarProfessor({ nome: 'Professor Ocupado' });
        const local = await bd.criarLocal({ campusId: campus.id, nome: 'Sala Disputada' });
        const horario = await bd.horarioDoTurno('matutino', 1);

        // Duas turmas diferentes, mesmo professor, mesmo local, mesma faixa de
        // horario: o banco aceita, o painel precisa denunciar.
        await bd.criarAula({
            turmaId: turmaA.id,
            professorId: professor.id,
            localId: local.id,
            diaSemana: 1,
            horarioTurnoId: horario.id,
        });
        await bd.criarAula({
            turmaId: turmaB.id,
            professorId: professor.id,
            localId: local.id,
            diaSemana: 1,
            horarioTurnoId: horario.id,
        });

        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const respostaAdmin = await abrirPainel(admin);

        expect(totalPendenciaTipo(respostaAdmin.text, 'professor_sobreposto')).toBe(2);
        expect(totalPendenciaTipo(respostaAdmin.text, 'local_sobreposto')).toBe(2);
        expect(respostaAdmin.text).toContain('Professor Ocupado');
        expect(respostaAdmin.text).toContain('Sala Disputada');
        // Cada ocorrencia leva ao montador de grade da turma.
        expect(respostaAdmin.text).toContain(`/admin/aulas/turma/${turmaA.id}`);
        expect(respostaAdmin.text).toContain(`/admin/aulas/turma/${turmaB.id}`);

        // O coordenador do curso A ve apenas a aula dele, mas continua sendo
        // avisado do choque (a outra aula esta fora do escopo dele).
        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            senha: SENHA,
            cursosIds: [cursoA.id],
        });
        const respostaCoordenador = await abrirPainel(coordenador);

        expect(totalPendenciaTipo(respostaCoordenador.text, 'professor_sobreposto')).toBe(1);
        expect(respostaCoordenador.text).toContain('Turma Conflito A');
        expect(respostaCoordenador.text).not.toContain('Turma Conflito B');
    });

    test('detecta turno divergente e local de outro campus', async () => {
        const campusA = await bd.criarCampus({ nome: 'Campus Turno A' });
        const campusB = await bd.criarCampus({ nome: 'Campus Turno B' });
        const curso = await bd.criarCurso({ campusIds: [campusA.id, campusB.id] });

        const turma = await bd.criarTurma({
            nome: 'Turma Divergente',
            cursoId: curso.id,
            campusId: campusA.id,
            turnoSlug: 'matutino',
        });

        const horarioNoturno = await bd.horarioDoTurno('noturno', 1);
        const localOutroCampus = await bd.criarLocal({
            campusId: campusB.id,
            nome: 'Sala Distante',
        });

        await bd.criarAula({
            turmaId: turma.id,
            localId: localOutroCampus.id,
            diaSemana: 2,
            horarioTurnoId: horarioNoturno.id,
        });

        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const resposta = await abrirPainel(admin);

        expect(totalPendenciaTipo(resposta.text, 'turno_divergente')).toBe(1);
        expect(totalPendenciaTipo(resposta.text, 'campus_divergente')).toBe(1);
        expect(resposta.text).toContain('Campus Turno B');
    });

    test('grade sem problemas mostra o estado vazio positivo', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turma = await bd.criarTurma({ cursoId: curso.id, campusId: campus.id });
        const local = await bd.criarLocal({ campusId: campus.id });
        const professor = await bd.criarProfessor();

        await bd.criarAula({
            turmaId: turma.id,
            professorId: professor.id,
            localId: local.id,
            diaSemana: 1,
            ordemHorario: 1,
        });

        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const resposta = await abrirPainel(admin);

        expect(totalPendencias(resposta.text)).toBe(0);
        expect(resposta.text).toContain('Nenhuma pendência encontrada');
    });
});

describe('periodo letivo', () => {
    test('o periodo em destaque vem do banco e nao esta fixo no HTML', async () => {
        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const original = await bd.periodoAtual();

        const antes = await abrirPainel(admin);
        expect(periodoEmDestaque(antes.text)).toBe(original.codigo);

        try {
            await bd.query('UPDATE periodos_letivos SET atual = FALSE WHERE atual');
            await bd.query(
                `INSERT INTO periodos_letivos (codigo, ano, semestre, atual, ativo)
                 VALUES ('2099.1', 2099, 1, TRUE, TRUE)
                 ON CONFLICT (codigo) DO UPDATE SET atual = TRUE, ativo = TRUE`
            );

            const depois = await abrirPainel(admin);
            expect(periodoEmDestaque(depois.text)).toBe('2099.1');
            expect(periodoEmDestaque(depois.text)).not.toBe(original.codigo);
        } finally {
            await bd.query('UPDATE periodos_letivos SET atual = FALSE WHERE atual');
            await bd.query(`DELETE FROM periodos_letivos WHERE codigo = '2099.1'`);
            await bd.query('UPDATE periodos_letivos SET atual = TRUE WHERE id = $1', [original.id]);
        }
    });

    test('sem periodo atual o painel avisa e aponta para /admin/periodos', async () => {
        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const original = await bd.periodoAtual();

        try {
            await bd.query('UPDATE periodos_letivos SET atual = FALSE WHERE atual');

            const resposta = await abrirPainel(admin);

            expect(resposta.status).toBe(200);
            expect(periodoEmDestaque(resposta.text)).toBeNull();
            expect(resposta.text).toContain('Nenhum período letivo marcado como atual');
            expect(resposta.text).toContain('href="/admin/periodos"');
        } finally {
            await bd.query('UPDATE periodos_letivos SET atual = TRUE WHERE id = $1', [original.id]);
        }
    });

    test('a nota do indicador de turmas usa o periodo atual do banco', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        await bd.criarTurma({ cursoId: curso.id, campusId: campus.id });

        const admin = await bd.criarUsuario({ perfil: 'admin', senha: SENHA });
        const periodo = await bd.periodoAtual();

        const resposta = await abrirPainel(admin);

        expect(resposta.text).toContain(`1 no período ${periodo.codigo}`);
    });
});
