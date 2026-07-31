/**
 * Testes dos CRUDs academicos: cursos, periodos letivos, disciplinas e
 * professores.
 *
 * Cobrem o caminho feliz (criar, editar, inativar, reativar), as regras de
 * unicidade com mensagem por campo, o bloqueio de exclusao com dependencias, a
 * exclusividade do periodo letivo atual, a autorizacao (coordenador so le) e os
 * recursos de listagem (busca e paginacao).
 *
 * Rodar sempre em schema isolado:
 *   NODE_ENV=test DB_SCHEMA=teste_academico npx jest tests/crud-academico.test.js --runInBand
 */
const request = require('supertest');

const bd = require('./helpers/db');
const { criarApp, criarAgente, login, postComCsrf } = require('./helpers/app');

const SENHA = 'SenhaTeste@123';

let app;

/**
 * Cria um usuario com o perfil informado e devolve um agente ja autenticado.
 * @param {'admin'|'coordenador'|'nap'} perfil
 * @param {object} [opcoes] repassadas para `bd.criarUsuario`
 * @returns {Promise<object>} agente do supertest
 */
const agenteLogado = async (perfil = 'admin', opcoes = {}) => {
    const usuario = await bd.criarUsuario({ perfil, senha: SENHA, ...opcoes });
    return login(criarAgente(app), usuario.email, SENHA);
};

/**
 * Conta as linhas de uma listagem pelo link "editar" de cada registro.
 * @param {string} html
 * @param {string} recurso ex.: 'cursos'
 * @returns {number}
 */
const contarLinhas = (html, recurso) => {
    const padrao = new RegExp(`/admin/${recurso}/\\d+/editar`, 'g');
    return (html.match(padrao) || []).length;
};

/**
 * Le um curso pelo nome direto do banco.
 * @param {string} nome
 * @returns {Promise<object|undefined>}
 */
const cursoPorNome = async (nome) => {
    const resultado = await bd.query('SELECT * FROM cursos WHERE nome = $1', [nome]);
    return resultado.rows[0];
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
// Autenticacao e autorizacao
// ---------------------------------------------------------------------------

describe('acesso as telas de cadastro', () => {
    test('usuario nao autenticado e redirecionado para /login', async () => {
        const caminhos = [
            '/admin/cursos',
            '/admin/periodos',
            '/admin/disciplinas',
            '/admin/professores',
        ];

        for (const caminho of caminhos) {
            const resposta = await request(app).get(caminho);
            expect(resposta.status).toBe(302);
            expect(resposta.headers.location).toContain('/login');
        }
    });

    test('coordenador consegue ler os quatro cadastros', async () => {
        const agente = await agenteLogado('coordenador');

        for (const recurso of ['cursos', 'periodos', 'disciplinas', 'professores']) {
            const resposta = await agente.get(`/admin/${recurso}`);
            expect(resposta.status).toBe(200);
        }
    });

    test('coordenador recebe 403 ao tentar criar curso', async () => {
        const agente = await agenteLogado('coordenador');

        const formulario = await agente.get('/admin/cursos/novo');
        expect(formulario.status).toBe(403);

        const resposta = await postComCsrf(agente, '/admin/cursos', {
            nome: 'Curso Proibido',
            ativo: '1',
        });

        expect(resposta.status).toBe(403);
        expect(await cursoPorNome('Curso Proibido')).toBeUndefined();
    });

    test('nap recebe 403 ao tentar inativar professor', async () => {
        const professor = await bd.criarProfessor({ nome: 'Professor Protegido' });
        const agente = await agenteLogado('nap');

        const resposta = await postComCsrf(agente, `/admin/professores/${professor.id}/status`, {
            ativo: '0',
        });

        expect(resposta.status).toBe(403);

        const registro = await bd.query('SELECT ativo FROM professores WHERE id = $1', [
            professor.id,
        ]);
        expect(registro.rows[0].ativo).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Renderizacao das telas
// ---------------------------------------------------------------------------

describe('telas de cadastro renderizam', () => {
    test('formularios de criacao abrem sem erro de template', async () => {
        await bd.criarCampus({ nome: 'Campus Formulário' });
        await bd.criarCurso({ nome: 'Curso Formulário' });
        const agente = await agenteLogado('admin');

        const telas = {
            '/admin/cursos/novo': 'Novo curso',
            '/admin/periodos/novo': 'Novo período letivo',
            '/admin/disciplinas/nova': 'Nova disciplina',
            '/admin/professores/novo': 'Novo professor',
        };

        for (const [caminho, titulo] of Object.entries(telas)) {
            const resposta = await agente.get(caminho);
            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain(titulo);
            expect(resposta.text).toContain('name="_csrf"');
        }
    });

    test('formularios de edicao trazem os dados gravados', async () => {
        const campus = await bd.criarCampus({ nome: 'Campus Edição' });
        const curso = await bd.criarCurso({
            nome: 'Curso Editável',
            sigla: 'EDT',
            coordenador: 'Prof. Editor',
            campusIds: [campus.id],
        });
        const disciplina = await bd.criarDisciplina({
            nome: 'Disciplina Editável',
            codigo: 'EDI1',
            cursoId: curso.id,
            semestreSugerido: 4,
        });
        const professor = await bd.criarProfessor({
            nome: 'Professor Editável',
            email: 'editavel@escola.edu',
        });
        const periodo = await bd.periodoAtual();
        const agente = await agenteLogado('admin');

        const telaCurso = await agente.get(`/admin/cursos/${curso.id}/editar`);
        expect(telaCurso.status).toBe(200);
        expect(telaCurso.text).toContain('value="Curso Editável"');
        expect(telaCurso.text).toContain('value="Prof. Editor"');
        expect(telaCurso.text).toContain(`id="campus-${campus.id}"`);

        const telaPeriodo = await agente.get(`/admin/periodos/${periodo.id}/editar`);
        expect(telaPeriodo.status).toBe(200);
        expect(telaPeriodo.text).toContain(`value="${periodo.codigo}"`);

        const telaDisciplina = await agente.get(`/admin/disciplinas/${disciplina.id}/editar`);
        expect(telaDisciplina.status).toBe(200);
        expect(telaDisciplina.text).toContain('value="Disciplina Editável"');
        expect(telaDisciplina.text).toContain(`name="semestre_${curso.id}"`);
        expect(telaDisciplina.text).toContain('value="4"');

        const telaProfessor = await agente.get(`/admin/professores/${professor.id}/editar`);
        expect(telaProfessor.status).toBe(200);
        expect(telaProfessor.text).toContain('value="editavel@escola.edu"');
    });

    test('id inexistente devolve 404', async () => {
        const agente = await agenteLogado('admin');

        for (const recurso of ['cursos', 'periodos', 'disciplinas', 'professores']) {
            const resposta = await agente.get(`/admin/${recurso}/999999/editar`);
            expect(resposta.status).toBe(404);
        }
    });

    test('erro de validacao na edicao reexibe o formulario preenchido', async () => {
        await bd.criarCurso({ nome: 'Curso Existente' });
        const alvo = await bd.criarCurso({ nome: 'Curso Alvo' });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, `/admin/cursos/${alvo.id}`, {
            nome: 'Curso Existente',
            sigla: 'ALV',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um curso com este nome.');
        expect(resposta.text).toContain('value="ALV"');
        expect(resposta.text).toContain('Editar curso');

        const registro = await bd.query('SELECT nome FROM cursos WHERE id = $1', [alvo.id]);
        expect(registro.rows[0].nome).toBe('Curso Alvo');
    });
});

// ---------------------------------------------------------------------------
// Cursos
// ---------------------------------------------------------------------------

describe('cursos', () => {
    test('cria um curso com vinculo de campus', async () => {
        const campusA = await bd.criarCampus({ nome: 'Campus Norte' });
        const campusB = await bd.criarCampus({ nome: 'Campus Sul' });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/cursos', {
            nome: 'Medicina',
            sigla: 'MED',
            coordenador: 'Dra. Silva',
            semestresTotal: '12',
            ativo: '1',
            campusIds: [String(campusA.id), String(campusB.id)],
        });

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toContain('/admin/cursos');

        const curso = await cursoPorNome('Medicina');
        expect(curso).toBeDefined();
        expect(curso.sigla).toBe('MED');
        expect(curso.coordenador).toBe('Dra. Silva');
        expect(curso.semestres_total).toBe(12);
        expect(curso.ativo).toBe(true);

        const vinculos = await bd.query(
            'SELECT campus_id FROM curso_campus WHERE curso_id = $1 ORDER BY campus_id',
            [curso.id]
        );
        expect(vinculos.rows.map((linha) => linha.campus_id).sort()).toEqual(
            [campusA.id, campusB.id].sort()
        );
    });

    test('edita um curso trocando os campus vinculados', async () => {
        const campusA = await bd.criarCampus({ nome: 'Campus Um' });
        const campusB = await bd.criarCampus({ nome: 'Campus Dois' });
        const curso = await bd.criarCurso({ nome: 'Direito', campusIds: [campusA.id] });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, `/admin/cursos/${curso.id}`, {
            nome: 'Direito Integral',
            sigla: 'DIR',
            semestresTotal: '10',
            ativo: '1',
            campusIds: String(campusB.id),
        });

        expect(resposta.status).toBe(302);

        const atualizado = await bd.query('SELECT * FROM cursos WHERE id = $1', [curso.id]);
        expect(atualizado.rows[0].nome).toBe('Direito Integral');
        expect(atualizado.rows[0].semestres_total).toBe(10);

        const vinculos = await bd.query('SELECT campus_id FROM curso_campus WHERE curso_id = $1', [
            curso.id,
        ]);
        expect(vinculos.rows.map((linha) => linha.campus_id)).toEqual([campusB.id]);
    });

    test('recusa nome de curso duplicado com mensagem no campo', async () => {
        await bd.criarCurso({ nome: 'Enfermagem' });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/cursos', {
            nome: 'enfermagem',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um curso com este nome.');
        // O que foi digitado volta preenchido no formulario.
        expect(resposta.text).toContain('value="enfermagem"');

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM cursos');
        expect(total.rows[0].total).toBe(1);
    });

    test('recusa curso sem nome e reexibe o restante do formulario', async () => {
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/cursos', {
            nome: '   ',
            sigla: 'ABC',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Informe o nome do curso.');
        expect(resposta.text).toContain('value="ABC"');
    });

    test('recusa quantidade de semestres fora da faixa', async () => {
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/cursos', {
            nome: 'Curso Longo',
            semestresTotal: '40',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain(
            'A quantidade de semestres deve ser um número inteiro entre 1 e 20.'
        );
        expect(await cursoPorNome('Curso Longo')).toBeUndefined();
    });

    test('nao inativa curso com turmas ativas', async () => {
        const curso = await bd.criarCurso({ nome: 'Psicologia' });
        await bd.criarTurma({ cursoId: curso.id, ativo: true });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, `/admin/cursos/${curso.id}/status`, {
            ativo: '0',
        });

        expect(resposta.status).toBe(302);

        const registro = await bd.query('SELECT ativo FROM cursos WHERE id = $1', [curso.id]);
        expect(registro.rows[0].ativo).toBe(true);

        const lista = await agente.get('/admin/cursos');
        expect(lista.text).toContain('Não é possível inativar');
    });

    test('inativa e reativa um curso sem turmas', async () => {
        const curso = await bd.criarCurso({ nome: 'Arquitetura' });
        const agente = await agenteLogado('admin');

        const inativar = await postComCsrf(agente, `/admin/cursos/${curso.id}/status`, {
            ativo: '0',
        });
        expect(inativar.status).toBe(302);

        let registro = await bd.query('SELECT ativo FROM cursos WHERE id = $1', [curso.id]);
        expect(registro.rows[0].ativo).toBe(false);

        const reativar = await postComCsrf(agente, `/admin/cursos/${curso.id}/status`, {
            ativo: '1',
        });
        expect(reativar.status).toBe(302);

        registro = await bd.query('SELECT ativo FROM cursos WHERE id = $1', [curso.id]);
        expect(registro.rows[0].ativo).toBe(true);
    });

    test('bloqueia exclusao de curso com turmas e permite sem vinculos', async () => {
        const comTurma = await bd.criarCurso({ nome: 'Odontologia' });
        await bd.criarTurma({ cursoId: comTurma.id });
        const semVinculo = await bd.criarCurso({ nome: 'Curso Vazio' });
        const agente = await agenteLogado('admin');

        const bloqueado = await postComCsrf(agente, `/admin/cursos/${comTurma.id}/excluir`, {});
        expect(bloqueado.status).toBe(302);

        const aindaExiste = await bd.query('SELECT id FROM cursos WHERE id = $1', [comTurma.id]);
        expect(aindaExiste.rowCount).toBe(1);

        const listaComErro = await agente.get('/admin/cursos');
        expect(listaComErro.text).toContain('Não é possível excluir');

        const removido = await postComCsrf(agente, `/admin/cursos/${semVinculo.id}/excluir`, {});
        expect(removido.status).toBe(302);

        const conferencia = await bd.query('SELECT id FROM cursos WHERE id = $1', [semVinculo.id]);
        expect(conferencia.rowCount).toBe(0);
    });

    test('filtra a listagem por busca, campus e situacao', async () => {
        const campus = await bd.criarCampus({ nome: 'Campus Alvo' });
        await bd.criarCurso({ nome: 'Nutrição', campusIds: [campus.id] });
        await bd.criarCurso({ nome: 'Fisioterapia' });
        await bd.criarCurso({ nome: 'Veterinária', ativo: false });
        const agente = await agenteLogado('admin');

        const todos = await agente.get('/admin/cursos');
        expect(contarLinhas(todos.text, 'cursos')).toBe(3);

        const busca = await agente.get('/admin/cursos?busca=Nutri');
        expect(contarLinhas(busca.text, 'cursos')).toBe(1);
        expect(busca.text).toContain('Nutrição');

        const porCampus = await agente.get(`/admin/cursos?campusId=${campus.id}`);
        expect(contarLinhas(porCampus.text, 'cursos')).toBe(1);

        const inativos = await agente.get('/admin/cursos?status=inativos');
        expect(contarLinhas(inativos.text, 'cursos')).toBe(1);
        expect(inativos.text).toContain('Veterinária');
    });

    test('pagina a listagem preservando o filtro', async () => {
        for (let indice = 1; indice <= 12; indice += 1) {
            await bd.criarCurso({ nome: `Curso Paginado ${String(indice).padStart(2, '0')}` });
        }
        const agente = await agenteLogado('admin');

        const primeira = await agente.get('/admin/cursos?por_pagina=10&busca=Paginado');
        expect(primeira.status).toBe(200);
        expect(contarLinhas(primeira.text, 'cursos')).toBe(10);
        expect(primeira.text).toContain('de <strong>12</strong>');

        const segunda = await agente.get('/admin/cursos?por_pagina=10&busca=Paginado&pagina=2');
        expect(contarLinhas(segunda.text, 'cursos')).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Periodos letivos
// ---------------------------------------------------------------------------

describe('periodos letivos', () => {
    test('deduz ano e semestre a partir do codigo', async () => {
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/periodos', {
            codigo: '2031.2',
            ano: '',
            semestre: '',
            ativo: '1',
        });

        expect(resposta.status).toBe(302);

        const registro = await bd.query('SELECT * FROM periodos_letivos WHERE codigo = $1', [
            '2031.2',
        ]);
        expect(registro.rows[0].ano).toBe(2031);
        expect(registro.rows[0].semestre).toBe(2);
    });

    test('marcar um novo periodo como atual desmarca o anterior sem erro do banco', async () => {
        const agente = await agenteLogado('admin');

        const primeiro = await postComCsrf(agente, '/admin/periodos', {
            codigo: '2040.1',
            ativo: '1',
            atual: '1',
        });
        expect(primeiro.status).toBe(302);

        const segundo = await postComCsrf(agente, '/admin/periodos', {
            codigo: '2040.2',
            ativo: '1',
            atual: '1',
        });
        expect(segundo.status).toBe(302);

        const atuais = await bd.query(
            'SELECT codigo FROM periodos_letivos WHERE atual ORDER BY codigo'
        );
        expect(atuais.rowCount).toBe(1);
        expect(atuais.rows[0].codigo).toBe('2040.2');
    });

    test('acao "definir como atual" troca o periodo vigente', async () => {
        const agente = await agenteLogado('admin');

        await postComCsrf(agente, '/admin/periodos', { codigo: '2041.1', ativo: '1' });
        const alvo = await bd.query('SELECT id FROM periodos_letivos WHERE codigo = $1', [
            '2041.1',
        ]);

        const resposta = await postComCsrf(agente, `/admin/periodos/${alvo.rows[0].id}/atual`, {});
        expect(resposta.status).toBe(302);

        const atuais = await bd.query('SELECT id, codigo FROM periodos_letivos WHERE atual');
        expect(atuais.rowCount).toBe(1);
        expect(atuais.rows[0].codigo).toBe('2041.1');
    });

    test('editar um periodo para atual tambem desmarca o anterior', async () => {
        const agente = await agenteLogado('admin');

        await postComCsrf(agente, '/admin/periodos', { codigo: '2042.1', ativo: '1', atual: '1' });
        await postComCsrf(agente, '/admin/periodos', { codigo: '2042.2', ativo: '1' });

        const alvo = await bd.query('SELECT id FROM periodos_letivos WHERE codigo = $1', [
            '2042.2',
        ]);

        const resposta = await postComCsrf(agente, `/admin/periodos/${alvo.rows[0].id}`, {
            codigo: '2042.2',
            ano: '2042',
            semestre: '2',
            ativo: '1',
            atual: '1',
        });

        expect(resposta.status).toBe(302);

        const atuais = await bd.query('SELECT codigo FROM periodos_letivos WHERE atual');
        expect(atuais.rowCount).toBe(1);
        expect(atuais.rows[0].codigo).toBe('2042.2');
    });

    test('recusa data de termino anterior a data de inicio', async () => {
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/periodos', {
            codigo: '2043.1',
            ativo: '1',
            dataInicio: '2043-03-01',
            dataFim: '2043-02-01',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain(
            'A data de término deve ser igual ou posterior à data de início.'
        );
        expect(resposta.text).toContain('value="2043-03-01"');

        const registro = await bd.query('SELECT id FROM periodos_letivos WHERE codigo = $1', [
            '2043.1',
        ]);
        expect(registro.rowCount).toBe(0);
    });

    test('recusa codigo de periodo duplicado', async () => {
        const agente = await agenteLogado('admin');
        await postComCsrf(agente, '/admin/periodos', { codigo: '2044.1', ativo: '1' });

        const resposta = await postComCsrf(agente, '/admin/periodos', {
            codigo: '2044.1',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um período letivo com este código.');
    });

    test('nao inativa nem exclui periodo com turmas', async () => {
        const turma = await bd.criarTurma();
        const agente = await agenteLogado('admin');

        const inativar = await postComCsrf(
            agente,
            `/admin/periodos/${turma.periodo_letivo_id}/status`,
            { ativo: '0' }
        );
        expect(inativar.status).toBe(302);

        let registro = await bd.query('SELECT ativo FROM periodos_letivos WHERE id = $1', [
            turma.periodo_letivo_id,
        ]);
        expect(registro.rows[0].ativo).toBe(true);

        const excluir = await postComCsrf(
            agente,
            `/admin/periodos/${turma.periodo_letivo_id}/excluir`,
            {}
        );
        expect(excluir.status).toBe(302);

        registro = await bd.query('SELECT id FROM periodos_letivos WHERE id = $1', [
            turma.periodo_letivo_id,
        ]);
        expect(registro.rowCount).toBe(1);

        const lista = await agente.get('/admin/periodos');
        expect(lista.text).toContain('Não é possível excluir');
    });
});

// ---------------------------------------------------------------------------
// Disciplinas
// ---------------------------------------------------------------------------

describe('disciplinas', () => {
    test('cria disciplina vinculada a cursos com semestre sugerido', async () => {
        const curso = await bd.criarCurso({ nome: 'Biomedicina' });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/disciplinas', {
            nome: 'Bioquímica',
            codigo: 'BIOQ1',
            cargaHoraria: '80',
            ativo: '1',
            cursosIds: String(curso.id),
            [`semestre_${curso.id}`]: '3',
        });

        expect(resposta.status).toBe(302);

        const disciplina = await bd.query('SELECT * FROM disciplinas WHERE nome = $1', [
            'Bioquímica',
        ]);
        expect(disciplina.rows[0].codigo).toBe('BIOQ1');
        expect(disciplina.rows[0].carga_horaria).toBe(80);

        const vinculo = await bd.query('SELECT * FROM curso_disciplinas WHERE disciplina_id = $1', [
            disciplina.rows[0].id,
        ]);
        expect(vinculo.rowCount).toBe(1);
        expect(vinculo.rows[0].curso_id).toBe(curso.id);
        expect(vinculo.rows[0].semestre_sugerido).toBe(3);
    });

    test('recusa codigo duplicado sem diferenciar maiusculas, com mensagem no campo', async () => {
        await bd.criarDisciplina({ nome: 'Anatomia', codigo: 'anat1' });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/disciplinas', {
            nome: 'Anatomia II',
            codigo: 'ANAT1',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe uma disciplina com este código.');
        expect(resposta.text).toContain('value="ANAT1"');

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM disciplinas');
        expect(total.rows[0].total).toBe(1);
    });

    test('recusa carga horaria invalida', async () => {
        const agente = await agenteLogado('admin');

        const zero = await postComCsrf(agente, '/admin/disciplinas', {
            nome: 'Sem Carga',
            cargaHoraria: '0',
            ativo: '1',
        });
        expect(zero.status).toBe(422);
        expect(zero.text).toContain('A carga horária deve ser um número inteiro maior que zero.');

        const texto = await postComCsrf(agente, '/admin/disciplinas', {
            nome: 'Carga Textual',
            cargaHoraria: 'sessenta',
            ativo: '1',
        });
        expect(texto.status).toBe(422);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM disciplinas');
        expect(total.rows[0].total).toBe(0);
    });

    test('edita a matriz curricular substituindo os vinculos', async () => {
        const cursoA = await bd.criarCurso({ nome: 'Curso A' });
        const cursoB = await bd.criarCurso({ nome: 'Curso B' });
        const disciplina = await bd.criarDisciplina({
            nome: 'Estatística',
            codigo: 'EST1',
            cursoId: cursoA.id,
            semestreSugerido: 1,
        });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, `/admin/disciplinas/${disciplina.id}`, {
            nome: 'Estatística Aplicada',
            codigo: 'EST1',
            cargaHoraria: '60',
            ativo: '1',
            cursosIds: String(cursoB.id),
            [`semestre_${cursoB.id}`]: '5',
        });

        expect(resposta.status).toBe(302);

        const vinculos = await bd.query(
            'SELECT curso_id, semestre_sugerido FROM curso_disciplinas WHERE disciplina_id = $1',
            [disciplina.id]
        );
        expect(vinculos.rowCount).toBe(1);
        expect(vinculos.rows[0].curso_id).toBe(cursoB.id);
        expect(vinculos.rows[0].semestre_sugerido).toBe(5);
    });

    test('bloqueia exclusao de disciplina usada em aulas e permite inativar', async () => {
        const disciplina = await bd.criarDisciplina({ nome: 'Farmacologia' });
        await bd.criarAula({ disciplinaId: disciplina.id });
        const agente = await agenteLogado('admin');

        const excluir = await postComCsrf(
            agente,
            `/admin/disciplinas/${disciplina.id}/excluir`,
            {}
        );
        expect(excluir.status).toBe(302);

        const existente = await bd.query('SELECT id FROM disciplinas WHERE id = $1', [
            disciplina.id,
        ]);
        expect(existente.rowCount).toBe(1);

        const lista = await agente.get('/admin/disciplinas');
        expect(lista.text).toContain('Não é possível excluir');

        const inativar = await postComCsrf(agente, `/admin/disciplinas/${disciplina.id}/status`, {
            ativo: '0',
        });
        expect(inativar.status).toBe(302);

        const registro = await bd.query('SELECT ativo FROM disciplinas WHERE id = $1', [
            disciplina.id,
        ]);
        expect(registro.rows[0].ativo).toBe(false);
    });

    test('filtra disciplinas por curso e por busca', async () => {
        const curso = await bd.criarCurso({ nome: 'Curso Filtrado' });
        await bd.criarDisciplina({ nome: 'Cálculo I', codigo: 'CAL1', cursoId: curso.id });
        await bd.criarDisciplina({ nome: 'Sociologia', codigo: 'SOC1' });
        const agente = await agenteLogado('admin');

        const todas = await agente.get('/admin/disciplinas');
        expect(contarLinhas(todas.text, 'disciplinas')).toBe(2);

        const porCurso = await agente.get(`/admin/disciplinas?cursoId=${curso.id}`);
        expect(contarLinhas(porCurso.text, 'disciplinas')).toBe(1);

        const porCodigo = await agente.get('/admin/disciplinas?busca=SOC1');
        expect(contarLinhas(porCodigo.text, 'disciplinas')).toBe(1);
        expect(porCodigo.text).toContain('Sociologia');
    });
});

// ---------------------------------------------------------------------------
// Professores
// ---------------------------------------------------------------------------

describe('professores', () => {
    test('cria um professor normalizando o e-mail', async () => {
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/professores', {
            nome: 'Marina Costa',
            email: '  Marina.Costa@Escola.EDU ',
            ativo: '1',
        });

        expect(resposta.status).toBe(302);

        const registro = await bd.query('SELECT * FROM professores WHERE nome = $1', [
            'Marina Costa',
        ]);
        expect(registro.rows[0].email).toBe('marina.costa@escola.edu');
        expect(registro.rows[0].ativo).toBe(true);
    });

    test('recusa e-mail duplicado sem diferenciar maiusculas', async () => {
        await bd.criarProfessor({ nome: 'Original', email: 'docente@escola.edu' });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/professores', {
            nome: 'Duplicado',
            email: 'DOCENTE@ESCOLA.EDU',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um professor com este e-mail.');

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM professores');
        expect(total.rows[0].total).toBe(1);
    });

    test('recusa e-mail em formato invalido', async () => {
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, '/admin/professores', {
            nome: 'Sem E-mail Válido',
            email: 'isso-nao-e-email',
            ativo: '1',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Informe um e-mail válido.');
        expect(resposta.text).toContain('value="isso-nao-e-email"');
    });

    test('inativa avisando sobre as aulas ativas e depois reativa', async () => {
        const professor = await bd.criarProfessor({ nome: 'Carlos Lima' });
        await bd.criarAula({ professorId: professor.id });
        const agente = await agenteLogado('admin');

        const inativar = await postComCsrf(agente, `/admin/professores/${professor.id}/status`, {
            ativo: '0',
        });
        expect(inativar.status).toBe(302);

        let registro = await bd.query('SELECT ativo FROM professores WHERE id = $1', [
            professor.id,
        ]);
        expect(registro.rows[0].ativo).toBe(false);

        const lista = await agente.get('/admin/professores');
        expect(lista.text).toContain('continua com 1 aula(s) ativa(s)');

        const reativar = await postComCsrf(agente, `/admin/professores/${professor.id}/status`, {
            ativo: '1',
        });
        expect(reativar.status).toBe(302);

        registro = await bd.query('SELECT ativo FROM professores WHERE id = $1', [professor.id]);
        expect(registro.rows[0].ativo).toBe(true);
    });

    test('bloqueia exclusao de professor com aulas e permite sem aulas', async () => {
        const comAula = await bd.criarProfessor({ nome: 'Com Aula' });
        await bd.criarAula({ professorId: comAula.id });
        const semAula = await bd.criarProfessor({ nome: 'Sem Aula' });
        const agente = await agenteLogado('admin');

        const bloqueado = await postComCsrf(agente, `/admin/professores/${comAula.id}/excluir`, {});
        expect(bloqueado.status).toBe(302);

        const existente = await bd.query('SELECT id FROM professores WHERE id = $1', [comAula.id]);
        expect(existente.rowCount).toBe(1);

        const lista = await agente.get('/admin/professores');
        expect(lista.text).toContain('Não é possível excluir');

        const removido = await postComCsrf(agente, `/admin/professores/${semAula.id}/excluir`, {});
        expect(removido.status).toBe(302);

        const conferencia = await bd.query('SELECT id FROM professores WHERE id = $1', [
            semAula.id,
        ]);
        expect(conferencia.rowCount).toBe(0);
    });

    test('busca e pagina a listagem de professores', async () => {
        for (let indice = 1; indice <= 12; indice += 1) {
            await bd.criarProfessor({
                nome: `Docente Listado ${String(indice).padStart(2, '0')}`,
                email: `docente.listado.${indice}@escola.edu`,
            });
        }
        await bd.criarProfessor({ nome: 'Zebra Solitária', email: 'zebra@escola.edu' });
        const agente = await agenteLogado('admin');

        const busca = await agente.get('/admin/professores?busca=zebra');
        expect(contarLinhas(busca.text, 'professores')).toBe(1);
        expect(busca.text).toContain('Zebra Solitária');

        const porEmail = await agente.get('/admin/professores?busca=docente.listado.7@');
        expect(contarLinhas(porEmail.text, 'professores')).toBe(1);

        const primeira = await agente.get('/admin/professores?busca=Docente Listado&por_pagina=10');
        expect(contarLinhas(primeira.text, 'professores')).toBe(10);
        expect(primeira.text).toContain('de <strong>12</strong>');

        const segunda = await agente.get(
            '/admin/professores?busca=Docente Listado&por_pagina=10&pagina=2'
        );
        expect(contarLinhas(segunda.text, 'professores')).toBe(2);
    });

    test('edita um professor mantendo o proprio e-mail', async () => {
        const professor = await bd.criarProfessor({
            nome: 'Renata Alves',
            email: 'renata@escola.edu',
        });
        const agente = await agenteLogado('admin');

        const resposta = await postComCsrf(agente, `/admin/professores/${professor.id}`, {
            nome: 'Renata Alves Souza',
            email: 'renata@escola.edu',
            ativo: '1',
        });

        expect(resposta.status).toBe(302);

        const registro = await bd.query('SELECT nome FROM professores WHERE id = $1', [
            professor.id,
        ]);
        expect(registro.rows[0].nome).toBe('Renata Alves Souza');
    });
});
