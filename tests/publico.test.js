/**
 * Area publica de consulta da grade horaria.
 *
 * Cobre os filtros (campus, curso, turno, semestre, turma e combinacoes), o
 * estado inicial sem filtros, a exclusao de registros inativos, o bloco de
 * aulas sem horario, a origem do periodo letivo, o vazamento de dados
 * sensiveis, a compatibilidade com os links antigos e o BASE_PATH.
 */
const request = require('supertest');

const bd = require('./helpers/db');

/** Instancia a aplicacao real. Falha de carga deve ser ruidosa, sem app substituto. */
const criarApp = () => require('../src/app').criarApp();

const app = criarApp();

/** Codigo de periodo usado apenas por esta suite (nao colide com o seed). */
const PERIODO_FUTURO = '2099.2';

/** GET simples na area publica. */
const abrir = (caminho, cabecalhos = {}) => {
    const requisicao = request(app).get(caminho);
    Object.entries(cabecalhos).forEach(([nome, valor]) => requisicao.set(nome, valor));
    return requisicao;
};

/** Trecho do HTML que contem a grade (ignora as opcoes dos filtros). */
const corpoDaGrade = (html) => {
    const inicio = html.indexOf('id="conteudo-principal"');
    const fim = html.indexOf('<footer');
    return inicio >= 0 && fim > inicio ? html.slice(inicio, fim) : html;
};

/**
 * Cenario minimo: um campus, um curso, uma turma e uma aula.
 * @param {object} [opcoes]
 */
const criarCenario = async ({
    campusNome,
    cursoNome,
    turmaNome,
    turnoSlug = 'matutino',
    semestreCurricular = 1,
    disciplinaNome,
    ordemHorario = 1,
    diaSemana = 1,
    turmaAtiva = true,
    aulaAtiva = true,
} = {}) => {
    const campus = await bd.criarCampus({ nome: campusNome });
    const curso = await bd.criarCurso({ nome: cursoNome, campusIds: [campus.id] });
    const turma = await bd.criarTurma({
        nome: turmaNome,
        campusId: campus.id,
        cursoId: curso.id,
        turnoSlug,
        semestreCurricular,
        ativo: turmaAtiva,
    });
    const disciplina = await bd.criarDisciplina({ nome: disciplinaNome });
    const aula = await bd.criarAula({
        turmaId: turma.id,
        disciplinaId: disciplina.id,
        diaSemana,
        ordemHorario,
        ativo: aulaAtiva,
    });

    return { campus, curso, turma, disciplina, aula };
};

/** URL da consulta com os filtros informados. */
const url = (filtros = {}) => {
    const parametros = new URLSearchParams();
    Object.entries(filtros).forEach(([nome, valor]) => {
        if (valor !== undefined && valor !== null && valor !== '') {
            parametros.set(nome, String(valor));
        }
    });
    const consulta = parametros.toString();
    return consulta ? `/?${consulta}` : '/';
};

beforeEach(async () => {
    await bd.limparDados();
});

afterAll(async () => {
    await bd.limparDados();
    await bd.query('DELETE FROM periodos_letivos WHERE codigo = $1', [PERIODO_FUTURO]);
    await bd.encerrar();
});

describe('GET / — estado inicial', () => {
    test('responde 200 e orienta a selecao quando nao ha filtro', async () => {
        await criarCenario({ disciplinaNome: 'Anatomia Humana' });

        const resposta = await abrir('/');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Escolha o campus e o curso');
        expect(corpoDaGrade(resposta.text)).not.toContain('Anatomia Humana');
    });

    test('responde 200 mesmo sem nenhum dado cadastrado', async () => {
        const resposta = await abrir('/');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Grade Horária dos Cursos');
    });

    test('query string invalida vira filtro vazio, nunca erro', async () => {
        await criarCenario({ disciplinaNome: 'Bioquímica' });

        const resposta = await abrir(
            '/?campus=abc&semestre=999&turma=%3Cscript%3E&periodo=0&turno=' + 'x'.repeat(300)
        );

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Escolha o campus e o curso');
    });

    test('curso invalido e canonizado por redirecionamento, sem erro', async () => {
        await criarCenario({ disciplinaNome: 'Bioestatística' });

        // `curso` nao numerico cai na rota de compatibilidade: a URL e limpa e
        // a pagina responde normalmente no destino.
        const resposta = await abrir('/?campus=abc&curso=-1&semestre=999').redirects(2);

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Escolha o campus e o curso');
    });
});

describe('GET / — filtros', () => {
    test('filtra por campus', async () => {
        const campusA = await bd.criarCampus({ nome: 'Campus Norte' });
        const campusB = await bd.criarCampus({ nome: 'Campus Sul' });
        const curso = await bd.criarCurso({
            nome: 'Enfermagem',
            campusIds: [campusA.id, campusB.id],
        });

        const turmaA = await bd.criarTurma({ campusId: campusA.id, cursoId: curso.id });
        const turmaB = await bd.criarTurma({ campusId: campusB.id, cursoId: curso.id });

        const disciplinaA = await bd.criarDisciplina({ nome: 'Semiologia Norte' });
        const disciplinaB = await bd.criarDisciplina({ nome: 'Semiologia Sul' });

        await bd.criarAula({ turmaId: turmaA.id, disciplinaId: disciplinaA.id });
        await bd.criarAula({ turmaId: turmaB.id, disciplinaId: disciplinaB.id });

        const resposta = await abrir(url({ campus: campusA.id, curso: curso.id }));
        const grade = corpoDaGrade(resposta.text);

        expect(resposta.status).toBe(200);
        expect(grade).toContain('Semiologia Norte');
        expect(grade).not.toContain('Semiologia Sul');
    });

    test('filtra por curso', async () => {
        const campus = await bd.criarCampus({ nome: 'Campus Central' });
        const direito = await bd.criarCurso({ nome: 'Direito', campusIds: [campus.id] });
        const medicina = await bd.criarCurso({ nome: 'Medicina', campusIds: [campus.id] });

        const turmaDireito = await bd.criarTurma({ campusId: campus.id, cursoId: direito.id });
        const turmaMedicina = await bd.criarTurma({ campusId: campus.id, cursoId: medicina.id });

        const disciplinaDireito = await bd.criarDisciplina({ nome: 'Direito Penal' });
        const disciplinaMedicina = await bd.criarDisciplina({ nome: 'Fisiologia Médica' });

        await bd.criarAula({ turmaId: turmaDireito.id, disciplinaId: disciplinaDireito.id });
        await bd.criarAula({ turmaId: turmaMedicina.id, disciplinaId: disciplinaMedicina.id });

        const resposta = await abrir(url({ campus: campus.id, curso: direito.id }));
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Direito Penal');
        expect(grade).not.toContain('Fisiologia Médica');
    });

    test('filtra por turno', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const matutino = await bd.turnoPorSlug('matutino');
        const noturno = await bd.turnoPorSlug('noturno');

        const turmaManha = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            turnoId: matutino.id,
        });
        const turmaNoite = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            turnoId: noturno.id,
        });

        const manha = await bd.criarDisciplina({ nome: 'Cálculo da Manhã' });
        const noite = await bd.criarDisciplina({ nome: 'Cálculo da Noite' });

        await bd.criarAula({ turmaId: turmaManha.id, disciplinaId: manha.id });
        await bd.criarAula({ turmaId: turmaNoite.id, disciplinaId: noite.id });

        const resposta = await abrir(
            url({ campus: campus.id, curso: curso.id, turno: noturno.id })
        );
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Cálculo da Noite');
        expect(grade).not.toContain('Cálculo da Manhã');
    });

    test('filtra por semestre curricular', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });

        const primeiro = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            semestreCurricular: 1,
        });
        const quinto = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            semestreCurricular: 5,
        });

        const disciplinaUm = await bd.criarDisciplina({ nome: 'Introdução ao Curso' });
        const disciplinaCinco = await bd.criarDisciplina({ nome: 'Estágio Supervisionado' });

        await bd.criarAula({ turmaId: primeiro.id, disciplinaId: disciplinaUm.id });
        await bd.criarAula({ turmaId: quinto.id, disciplinaId: disciplinaCinco.id });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id, semestre: 5 }));
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Estágio Supervisionado');
        expect(grade).not.toContain('Introdução ao Curso');
    });

    test('filtra por turma', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });

        const turmaA = await bd.criarTurma({
            nome: 'Turma A',
            campusId: campus.id,
            cursoId: curso.id,
        });
        const turmaB = await bd.criarTurma({
            nome: 'Turma B',
            campusId: campus.id,
            cursoId: curso.id,
        });

        const disciplinaA = await bd.criarDisciplina({ nome: 'Sociologia Aplicada' });
        const disciplinaB = await bd.criarDisciplina({ nome: 'Antropologia Geral' });

        await bd.criarAula({ turmaId: turmaA.id, disciplinaId: disciplinaA.id });
        await bd.criarAula({ turmaId: turmaB.id, disciplinaId: disciplinaB.id });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id, turma: turmaA.id }));
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Sociologia Aplicada');
        expect(grade).not.toContain('Antropologia Geral');
    });

    test('combina campus, curso, turno e semestre', async () => {
        const campus = await bd.criarCampus({ nome: 'Campus Combinado' });
        const outroCampus = await bd.criarCampus({ nome: 'Campus Descartado' });
        const curso = await bd.criarCurso({
            nome: 'Psicologia',
            campusIds: [campus.id, outroCampus.id],
        });
        const noturno = await bd.turnoPorSlug('noturno');
        const matutino = await bd.turnoPorSlug('matutino');

        const alvo = await bd.criarTurma({
            nome: 'Psico 3 Noite',
            campusId: campus.id,
            cursoId: curso.id,
            turnoId: noturno.id,
            semestreCurricular: 3,
        });
        const ruidoTurno = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            turnoId: matutino.id,
            semestreCurricular: 3,
        });
        const ruidoSemestre = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            turnoId: noturno.id,
            semestreCurricular: 4,
        });
        const ruidoCampus = await bd.criarTurma({
            campusId: outroCampus.id,
            cursoId: curso.id,
            turnoId: noturno.id,
            semestreCurricular: 3,
        });

        const esperada = await bd.criarDisciplina({ nome: 'Psicopatologia Alvo' });
        const descartadaTurno = await bd.criarDisciplina({ nome: 'Ruído de Turno' });
        const descartadaSemestre = await bd.criarDisciplina({ nome: 'Ruído de Semestre' });
        const descartadaCampus = await bd.criarDisciplina({ nome: 'Ruído de Campus' });

        await bd.criarAula({ turmaId: alvo.id, disciplinaId: esperada.id });
        await bd.criarAula({ turmaId: ruidoTurno.id, disciplinaId: descartadaTurno.id });
        await bd.criarAula({ turmaId: ruidoSemestre.id, disciplinaId: descartadaSemestre.id });
        await bd.criarAula({ turmaId: ruidoCampus.id, disciplinaId: descartadaCampus.id });

        const resposta = await abrir(
            url({ campus: campus.id, curso: curso.id, turno: noturno.id, semestre: 3 })
        );
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Psicopatologia Alvo');
        expect(grade).not.toContain('Ruído de Turno');
        expect(grade).not.toContain('Ruído de Semestre');
        expect(grade).not.toContain('Ruído de Campus');
    });

    test('encadeia os filtros: campus limita a lista de cursos', async () => {
        const campusA = await bd.criarCampus({ nome: 'Campus Alfa' });
        const campusB = await bd.criarCampus({ nome: 'Campus Beta' });

        const cursoDoAlfa = await bd.criarCurso({ nome: 'Arquitetura', campusIds: [campusA.id] });
        const cursoDoBeta = await bd.criarCurso({ nome: 'Nutrição', campusIds: [campusB.id] });

        await bd.criarTurma({ campusId: campusA.id, cursoId: cursoDoAlfa.id });
        await bd.criarTurma({ campusId: campusB.id, cursoId: cursoDoBeta.id });

        const semFiltro = await abrir('/');
        expect(semFiltro.text).toContain('Arquitetura');
        expect(semFiltro.text).toContain('Nutrição');

        const comCampus = await abrir(url({ campus: campusA.id }));
        expect(comCampus.text).toContain('Arquitetura');
        expect(comCampus.text).not.toContain('Nutrição');
    });

    test('descarta curso que nao pertence ao campus escolhido', async () => {
        const campusA = await bd.criarCampus({ nome: 'Campus Um' });
        const campusB = await bd.criarCampus({ nome: 'Campus Dois' });
        const cursoDoB = await bd.criarCurso({ nome: 'Odontologia', campusIds: [campusB.id] });

        await bd.criarTurma({ campusId: campusA.id });
        await bd.criarTurma({ campusId: campusB.id, cursoId: cursoDoB.id });

        const resposta = await abrir(url({ campus: campusA.id, curso: cursoDoB.id }));

        // Curso invalido para o campus -> volta ao estado de orientacao.
        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Escolha o campus e o curso');
    });
});

describe('GET / — regras de exibicao', () => {
    test('nao exibe turma inativa nem aula inativa', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });

        const turmaAtiva = await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });
        const turmaInativa = await bd.criarTurma({
            nome: 'Turma Desativada',
            campusId: campus.id,
            cursoId: curso.id,
            ativo: false,
        });

        const visivel = await bd.criarDisciplina({ nome: 'Disciplina Visível' });
        const aulaDesligada = await bd.criarDisciplina({ nome: 'Disciplina Desativada' });
        const daTurmaInativa = await bd.criarDisciplina({ nome: 'Disciplina Da Turma Inativa' });

        await bd.criarAula({ turmaId: turmaAtiva.id, disciplinaId: visivel.id, ordemHorario: 1 });
        await bd.criarAula({
            turmaId: turmaAtiva.id,
            disciplinaId: aulaDesligada.id,
            ordemHorario: 2,
            ativo: false,
        });
        await bd.criarAula({ turmaId: turmaInativa.id, disciplinaId: daTurmaInativa.id });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id }));
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Disciplina Visível');
        expect(grade).not.toContain('Disciplina Desativada');
        expect(grade).not.toContain('Disciplina Da Turma Inativa');
        expect(grade).not.toContain('Turma Desativada');
    });

    test('nao exibe curso nem campus inativos', async () => {
        const campusInativo = await bd.criarCampus({ nome: 'Campus Fechado', ativo: false });
        const cursoInativo = await bd.criarCurso({ nome: 'Curso Extinto', ativo: false });
        const campus = await bd.criarCampus({ nome: 'Campus Aberto' });

        await bd.criarTurma({ campusId: campusInativo.id });
        await bd.criarTurma({ campusId: campus.id, cursoId: cursoInativo.id });

        const resposta = await abrir('/');

        expect(resposta.text).not.toContain('Campus Fechado');
        expect(resposta.text).not.toContain('Curso Extinto');
    });

    test('nao exibe professor nem local inativos', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turma = await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });
        const disciplina = await bd.criarDisciplina({ nome: 'Estatística' });

        const professor = await bd.criarProfessor({ nome: 'Professora Afastada', ativo: false });
        const local = await bd.criarLocal({
            campusId: campus.id,
            nome: 'Sala Interditada',
            ativo: false,
        });

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            localId: local.id,
        });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id }));
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Estatística');
        expect(grade).not.toContain('Professora Afastada');
        expect(grade).not.toContain('Sala Interditada');
    });

    test('aula sem horario aparece no bloco "Horário a definir"', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turma = await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });

        const comHorario = await bd.criarDisciplina({ nome: 'Disciplina Com Horário' });
        const semHorario = await bd.criarDisciplina({ nome: 'Disciplina Sem Horário' });

        await bd.criarAula({ turmaId: turma.id, disciplinaId: comHorario.id, ordemHorario: 1 });
        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: semHorario.id,
            diaSemana: 3,
            horarioTurnoId: null,
        });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id }));
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Horário a definir');
        expect(grade).toContain('Disciplina Sem Horário');
        expect(grade).toContain('Disciplina Com Horário');

        // A pendencia fica no bloco proprio, depois da tabela regular.
        const posicaoPendente = grade.indexOf('Horário a definir');
        expect(grade.indexOf('Disciplina Sem Horário')).toBeGreaterThan(posicaoPendente);
    });

    test('exibe dia, horario, disciplina, professor, local e modalidade', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turma = await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });
        const disciplina = await bd.criarDisciplina({ nome: 'Farmacologia' });
        const professor = await bd.criarProfessor({ nome: 'Carla Menezes' });
        const local = await bd.criarLocal({ campusId: campus.id, nome: 'Laboratório 3' });
        const horario = await bd.horarioDoTurno('matutino', 1);

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            localId: local.id,
            diaSemana: 2,
            ordemHorario: 1,
            modalidade: 'hibrido',
        });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id }));
        const grade = corpoDaGrade(resposta.text);

        expect(grade).toContain('Terça-feira');
        expect(grade).toContain(String(horario.hora_inicio).slice(0, 5));
        expect(grade).toContain(String(horario.hora_fim).slice(0, 5));
        expect(grade).toContain('Farmacologia');
        expect(grade).toContain('Carla Menezes');
        expect(grade).toContain('Laboratório 3');
        expect(grade).toContain('Híbrido');
    });

    test('nao expoe e-mail de professor nem observacao administrativa', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turma = await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });
        const disciplina = await bd.criarDisciplina({ nome: 'Metodologia Científica' });
        const professor = await bd.criarProfessor({
            nome: 'Rui Barbosa',
            email: 'rui.barbosa@interno.teste',
        });

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            observacao: 'Substituir docente a partir de abril (interno)',
        });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id }));

        expect(resposta.text).toContain('Rui Barbosa');
        expect(resposta.text).not.toContain('rui.barbosa@interno.teste');
        expect(resposta.text).not.toContain('Substituir docente');

        // Nenhum e-mail em lugar nenhum do documento. O `@` das URLs de CDN
        // ("bootstrap@5.3.3", "Inter:wght@300") nao forma endereco valido.
        const enderecos = resposta.text.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g) || [];
        expect(enderecos).toEqual([]);
    });
});

describe('GET / — periodo letivo', () => {
    test('exibe o periodo letivo vindo do banco, nao um valor fixo', async () => {
        const atual = await bd.periodoAtual();
        const futuro = (
            await bd.query(
                `INSERT INTO periodos_letivos (codigo, ano, semestre, atual, ativo)
                 VALUES ($1, 2099, 2, FALSE, TRUE)
                 ON CONFLICT (codigo) DO UPDATE SET ativo = TRUE
                 RETURNING *`,
                [PERIODO_FUTURO]
            )
        ).rows[0];

        const campus = await bd.criarCampus({ nome: 'Campus do Futuro' });
        const curso = await bd.criarCurso({ nome: 'Engenharia', campusIds: [campus.id] });

        const turmaAtual = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            periodoLetivoId: atual.id,
        });
        const turmaFutura = await bd.criarTurma({
            campusId: campus.id,
            cursoId: curso.id,
            periodoLetivoId: futuro.id,
        });

        const agora = await bd.criarDisciplina({ nome: 'Disciplina do Presente' });
        const depois = await bd.criarDisciplina({ nome: 'Disciplina do Futuro' });

        await bd.criarAula({ turmaId: turmaAtual.id, disciplinaId: agora.id });
        await bd.criarAula({ turmaId: turmaFutura.id, disciplinaId: depois.id });

        // Sem parametro, vale o periodo marcado como atual no banco.
        const padrao = await abrir(url({ campus: campus.id, curso: curso.id }));
        expect(padrao.text).toMatch(
            new RegExp(`Período letivo:[\\s\\S]{0,200}?${atual.codigo.replace('.', '\\.')}`)
        );
        expect(corpoDaGrade(padrao.text)).toContain('Disciplina do Presente');
        expect(corpoDaGrade(padrao.text)).not.toContain('Disciplina do Futuro');

        // Com parametro, vale o periodo escolhido.
        const escolhido = await abrir(
            url({ periodo: futuro.id, campus: campus.id, curso: curso.id })
        );
        expect(escolhido.text).toMatch(
            new RegExp(`Período letivo:[\\s\\S]{0,200}?${PERIODO_FUTURO.replace('.', '\\.')}`)
        );
        expect(escolhido.text).toContain(`Grade Horária · ${PERIODO_FUTURO}`);
        expect(corpoDaGrade(escolhido.text)).toContain('Disciplina do Futuro');
        expect(corpoDaGrade(escolhido.text)).not.toContain('Disciplina do Presente');
    });
});

describe('GET / — compatibilidade com os links antigos', () => {
    test('redireciona ?unidade=<slug>&curso=<slug> para a URL com ids', async () => {
        const campus = await bd.criarCampus({ nome: 'Águas Claras', sigla: 'AC' });
        const curso = await bd.criarCurso({ nome: 'Direito', campusIds: [campus.id] });
        await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });

        const resposta = await abrir('/?unidade=aguas-claras&curso=direito');

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe(`/?campus=${campus.id}&curso=${curso.id}`);
    });

    test('redireciona mesmo quando o slug antigo nao existe mais', async () => {
        await bd.criarTurma();

        const resposta = await abrir('/?unidade=campus-que-nao-existe');

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe('/');
    });

    test('nao confunde curso numerico (formato atual) com slug legado', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id }));

        expect(resposta.status).toBe(200);
    });
});

describe('BASE_PATH', () => {
    test('links, formulario e assets respeitam o prefixo do proxy', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });

        const resposta = await abrir(url({ campus: campus.id, curso: curso.id }), {
            'X-Forwarded-Prefix': '/grades',
        });

        expect(resposta.status).toBe(200);
        // O CSS sai com selo de versao (?v=...) para o deploy invalidar o cache
        // do navegador; o que este teste guarda e o prefixo vindo do proxy.
        expect(resposta.text).toMatch(/href="\/grades\/css\/publico\.css(\?v=[a-z0-9]+)?"/);
        expect(resposta.text).toContain('action="/grades/"');
        expect(resposta.text).toContain('src="/grades/logo_unieuro.png"');
        expect(resposta.text).toMatch(
            new RegExp(`href="/grades/imprimir\\?periodo=\\d+&amp;campus=${campus.id}`)
        );
    });

    test('redirecionamento legado mantem o prefixo do proxy', async () => {
        const campus = await bd.criarCampus({ nome: 'Asa Sul', sigla: 'AS' });
        const curso = await bd.criarCurso({ nome: 'Administração', campusIds: [campus.id] });
        await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });

        const resposta = await abrir('/?unidade=asa-sul&curso=administracao', {
            'X-Forwarded-Prefix': '/grades',
        });

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe(`/grades/?campus=${campus.id}&curso=${curso.id}`);
    });
});

describe('GET /imprimir', () => {
    test('entrega a grade sem os filtros da tela', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turma = await bd.criarTurma({ campusId: campus.id, cursoId: curso.id });
        const disciplina = await bd.criarDisciplina({ nome: 'História da Arte' });
        await bd.criarAula({ turmaId: turma.id, disciplinaId: disciplina.id });

        const resposta = await abrir(`/imprimir?campus=${campus.id}&curso=${curso.id}`);

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('História da Arte');
        expect(resposta.text).not.toContain('Aplicar filtros');
    });
});
