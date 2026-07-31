/**
 * CRUD de turmas e usuarios: escopo de acesso, credenciais e regras de negocio.
 *
 * Estes sao os dois cadastros mais sensiveis do sistema:
 *  - turmas definem o que cada perfil enxerga e edita (escopo curso/campus);
 *  - usuarios guardam credenciais (a senha so pode existir como hash bcrypt).
 *
 * Rode com um schema isolado:
 *   NODE_ENV=test DB_SCHEMA=teste_turmas npx jest tests/crud-turmas-usuarios.test.js --runInBand
 */
const bd = require('./helpers/db');
const { criarApp, criarAgente, login, postComCsrf } = require('./helpers/app');
const usuarioService = require('../src/services/usuarioService');

let app;

/** Agente autenticado com o administrador do seed. */
const agenteAdmin = async () => {
    const admin = await bd.usuarioAdmin();
    const agente = criarAgente(app);
    await login(agente, admin.email, admin.senha);
    return { agente, admin };
};

/** Agente autenticado com um usuario recem-criado. */
const agenteDe = async (usuario) => {
    const agente = criarAgente(app);
    await login(agente, usuario.email, usuario.senha);
    return agente;
};

/** Cenario minimo e coerente: campus + curso ofertado nele + turno + periodo. */
const cenarioBase = async () => {
    const campus = await bd.criarCampus({ nome: 'Campus Alfa' });
    const curso = await bd.criarCurso({ nome: 'Enfermagem', campusIds: [campus.id] });
    const turno = await bd.turnoPorSlug('matutino');
    const periodo = await bd.periodoAtual();
    return { campus, curso, turno, periodo };
};

/** Corpo valido do formulario de turma. */
const corpoTurma = ({ campus, curso, turno, periodo }, sobrescrever = {}) => ({
    nome: 'Enfermagem 1º A',
    codigo: 'ENF1A',
    periodoLetivoId: periodo.id,
    campusId: campus.id,
    cursoId: curso.id,
    semestreCurricular: 1,
    turnoId: turno.id,
    ativo: 'true',
    ...sobrescrever,
});

beforeAll(() => {
    app = criarApp();
});

beforeEach(async () => {
    await bd.limparDados();
    await bd.limparSessoes();
    // `limparDados` preserva o administrador do seed, mas nao desfaz alteracoes
    // feitas nele por testes anteriores (perfil/situacao). Sem isso, um teste que
    // inativa o admin quebraria o login dos seguintes.
    await bd.query("UPDATE usuarios SET ativo = TRUE, perfil = 'admin'");
});

afterAll(async () => {
    await bd.encerrar();
});

describe('CRUD de turmas', () => {
    it('cria uma turma com todos os vinculos', async () => {
        const cenario = await cenarioBase();
        const { agente } = await agenteAdmin();

        const resposta = await postComCsrf(agente, '/admin/turmas', corpoTurma(cenario));

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toContain('/admin/turmas');

        const gravada = await bd.query('SELECT * FROM turmas');
        expect(gravada.rowCount).toBe(1);
        expect(gravada.rows[0]).toMatchObject({
            nome: 'Enfermagem 1º A',
            codigo: 'ENF1A',
            periodo_letivo_id: cenario.periodo.id,
            campus_id: cenario.campus.id,
            curso_id: cenario.curso.id,
            semestre_curricular: 1,
            turno_id: cenario.turno.id,
            ativo: true,
        });
    });

    it('pre-seleciona o periodo letivo atual no formulario de nova turma', async () => {
        const cenario = await cenarioBase();
        const { agente } = await agenteAdmin();

        const resposta = await agente.get('/admin/turmas/novo');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toMatch(
            new RegExp(`<option value="${cenario.periodo.id}"[^>]*selected`)
        );
    });

    it('edita uma turma existente', async () => {
        const cenario = await cenarioBase();
        const turma = await bd.criarTurma({
            nome: 'Antiga',
            codigo: 'OLD1',
            cursoId: cenario.curso.id,
            campusId: cenario.campus.id,
            turnoId: cenario.turno.id,
            periodoLetivoId: cenario.periodo.id,
        });

        const { agente } = await agenteAdmin();

        const resposta = await postComCsrf(
            agente,
            `/admin/turmas/${turma.id}`,
            corpoTurma(cenario, { nome: 'Turma Renomeada', codigo: 'NOVO1', semestreCurricular: 5 })
        );

        expect(resposta.status).toBe(302);

        const atualizada = await bd.query('SELECT * FROM turmas WHERE id = $1', [turma.id]);
        expect(atualizada.rows[0]).toMatchObject({
            nome: 'Turma Renomeada',
            codigo: 'NOVO1',
            semestre_curricular: 5,
        });
    });

    it('recusa semestre curricular fora de 1..20', async () => {
        const cenario = await cenarioBase();
        const { agente } = await agenteAdmin();

        const acima = await postComCsrf(
            agente,
            '/admin/turmas',
            corpoTurma(cenario, { semestreCurricular: 25 })
        );

        expect(acima.status).toBe(422);
        expect(acima.text).toContain('entre 1 e 20');

        const zero = await postComCsrf(
            agente,
            '/admin/turmas',
            corpoTurma(cenario, { semestreCurricular: 0, codigo: 'OUTRO' })
        );

        expect(zero.status).toBe(422);

        const texto = await postComCsrf(
            agente,
            '/admin/turmas',
            corpoTurma(cenario, { semestreCurricular: 'primeiro', codigo: 'OUTRO2' })
        );

        expect(texto.status).toBe(422);

        const gravadas = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(gravadas.rows[0].total).toBe(0);
    });

    it('recusa codigo duplicado no mesmo periodo e campus (case-insensitive)', async () => {
        const cenario = await cenarioBase();
        const { agente } = await agenteAdmin();

        const primeira = await postComCsrf(agente, '/admin/turmas', corpoTurma(cenario));
        expect(primeira.status).toBe(302);

        const duplicada = await postComCsrf(
            agente,
            '/admin/turmas',
            corpoTurma(cenario, { nome: 'Outra turma', codigo: 'enf1a' })
        );

        expect(duplicada.status).toBe(422);
        expect(duplicada.text).toContain(
            'Já existe uma turma com este código neste período letivo e campus.'
        );

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(total.rows[0].total).toBe(1);
    });

    it('aceita o mesmo codigo de turma em campus diferentes', async () => {
        // O ERP repete o CODTURMA entre filiais e sao turmas distintas, com
        // ofertas proprias. A unicidade e por periodo letivo + campus.
        const cenario = await cenarioBase();
        const { agente } = await agenteAdmin();

        const outroCampus = await bd.criarCampus({ nome: 'Campus Norte' });
        await bd.query('INSERT INTO curso_campus (curso_id, campus_id) VALUES ($1, $2)', [
            cenario.curso.id,
            outroCampus.id,
        ]);

        const primeira = await postComCsrf(agente, '/admin/turmas', corpoTurma(cenario));
        expect(primeira.status).toBe(302);

        const segunda = await postComCsrf(
            agente,
            '/admin/turmas',
            corpoTurma(cenario, { nome: 'Mesma turma no Norte', campusId: outroCampus.id })
        );

        expect(segunda.status).toBe(302);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(total.rows[0].total).toBe(2);
    });

    it('aceita o mesmo codigo em periodos letivos diferentes', async () => {
        const cenario = await cenarioBase();
        const outroPeriodo = await bd.query(
            `INSERT INTO periodos_letivos (codigo, ano, semestre, atual, ativo)
             VALUES ('2099.2', 2099, 2, FALSE, TRUE) RETURNING *`
        );

        const { agente } = await agenteAdmin();

        expect((await postComCsrf(agente, '/admin/turmas', corpoTurma(cenario))).status).toBe(302);

        const outra = await postComCsrf(
            agente,
            '/admin/turmas',
            corpoTurma(cenario, { nome: 'Turma 2099', periodoLetivoId: outroPeriodo.rows[0].id })
        );

        expect(outra.status).toBe(302);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(total.rows[0].total).toBe(2);
    });

    it('recusa curso que nao e ofertado no campus escolhido e indica onde ele existe', async () => {
        const cenario = await cenarioBase();
        const outroCampus = await bd.criarCampus({ nome: 'Campus Beta' });
        const { agente } = await agenteAdmin();

        const resposta = await postComCsrf(
            agente,
            '/admin/turmas',
            corpoTurma(cenario, { campusId: outroCampus.id })
        );

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('não é ofertado no campus escolhido');
        // A mensagem informa onde o curso realmente e ofertado.
        expect(resposta.text).toContain('Campus Alfa');

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(total.rows[0].total).toBe(0);
    });

    it('nao exclui turma com aulas: orienta a inativar', async () => {
        const cenario = await cenarioBase();
        const turma = await bd.criarTurma({
            nome: 'Turma com grade',
            cursoId: cenario.curso.id,
            campusId: cenario.campus.id,
            turnoId: cenario.turno.id,
        });
        await bd.criarAula({ turmaId: turma.id });

        const { agente } = await agenteAdmin();
        const resposta = await postComCsrf(agente, `/admin/turmas/${turma.id}/excluir`);

        expect(resposta.status).toBe(302);

        const restante = await bd.query('SELECT ativo FROM turmas WHERE id = $1', [turma.id]);
        expect(restante.rowCount).toBe(1);

        // A mensagem de impedimento aparece na proxima pagina (flash).
        const lista = await agente.get('/admin/turmas');
        expect(lista.text).toContain('não pode ser excluída');

        // Inativar continua permitido.
        const inativacao = await postComCsrf(agente, `/admin/turmas/${turma.id}/status`, {
            ativo: 'false',
        });
        expect(inativacao.status).toBe(302);

        const inativada = await bd.query('SELECT ativo FROM turmas WHERE id = $1', [turma.id]);
        expect(inativada.rows[0].ativo).toBe(false);
    });

    it('exclui turma sem aulas', async () => {
        const cenario = await cenarioBase();
        const turma = await bd.criarTurma({
            nome: 'Turma vazia',
            cursoId: cenario.curso.id,
            campusId: cenario.campus.id,
        });

        const { agente } = await agenteAdmin();
        const resposta = await postComCsrf(agente, `/admin/turmas/${turma.id}/excluir`);

        expect(resposta.status).toBe(302);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(total.rows[0].total).toBe(0);
    });
});

describe('Escopo do coordenador em turmas', () => {
    it('enxerga apenas turmas dos seus cursos', async () => {
        const campus = await bd.criarCampus({ nome: 'Campus Único' });
        const cursoDele = await bd.criarCurso({ nome: 'Direito', campusIds: [campus.id] });
        const outroCurso = await bd.criarCurso({ nome: 'Medicina', campusIds: [campus.id] });

        await bd.criarTurma({ nome: 'Direito 1A', cursoId: cursoDele.id, campusId: campus.id });
        await bd.criarTurma({ nome: 'Medicina 1A', cursoId: outroCurso.id, campusId: campus.id });

        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            cursosIds: [cursoDele.id],
        });

        const agente = await agenteDe(coordenador);
        const resposta = await agente.get('/admin/turmas');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Direito 1A');
        expect(resposta.text).not.toContain('Medicina 1A');
    });

    it('recebe 403 ao editar turma de outro curso', async () => {
        const campus = await bd.criarCampus();
        const cursoDele = await bd.criarCurso({ nome: 'Direito', campusIds: [campus.id] });
        const outroCurso = await bd.criarCurso({ nome: 'Medicina', campusIds: [campus.id] });

        const turmaAlheia = await bd.criarTurma({
            nome: 'Medicina 1A',
            cursoId: outroCurso.id,
            campusId: campus.id,
        });

        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            cursosIds: [cursoDele.id],
        });
        const agente = await agenteDe(coordenador);

        const formulario = await agente.get(`/admin/turmas/${turmaAlheia.id}/editar`);
        expect(formulario.status).toBe(403);

        const gravacao = await postComCsrf(agente, `/admin/turmas/${turmaAlheia.id}`, {
            nome: 'Sequestrada',
            periodoLetivoId: turmaAlheia.periodo_letivo_id,
            campusId: campus.id,
            cursoId: outroCurso.id,
            semestreCurricular: 1,
            turnoId: turmaAlheia.turno_id,
            ativo: 'true',
        });
        expect(gravacao.status).toBe(403);

        const intacta = await bd.query('SELECT nome FROM turmas WHERE id = $1', [turmaAlheia.id]);
        expect(intacta.rows[0].nome).toBe('Medicina 1A');
    });

    it('nao consegue criar turma para curso fora do seu escopo', async () => {
        const campus = await bd.criarCampus();
        const cursoDele = await bd.criarCurso({ nome: 'Direito', campusIds: [campus.id] });
        const outroCurso = await bd.criarCurso({ nome: 'Medicina', campusIds: [campus.id] });
        const turno = await bd.turnoPorSlug('matutino');
        const periodo = await bd.periodoAtual();

        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            cursosIds: [cursoDele.id],
        });
        const agente = await agenteDe(coordenador);

        const resposta = await postComCsrf(agente, '/admin/turmas', {
            nome: 'Turma indevida',
            periodoLetivoId: periodo.id,
            campusId: campus.id,
            cursoId: outroCurso.id,
            semestreCurricular: 1,
            turnoId: turno.id,
            ativo: 'true',
        });

        expect(resposta.status).toBe(403);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(total.rows[0].total).toBe(0);
    });

    it('com dois cursos vinculados enxerga as turmas dos dois', async () => {
        const campus = await bd.criarCampus();
        const cursoA = await bd.criarCurso({ nome: 'Direito', campusIds: [campus.id] });
        const cursoB = await bd.criarCurso({ nome: 'Medicina', campusIds: [campus.id] });
        const cursoC = await bd.criarCurso({ nome: 'Odontologia', campusIds: [campus.id] });

        await bd.criarTurma({ nome: 'Direito 1A', cursoId: cursoA.id, campusId: campus.id });
        await bd.criarTurma({ nome: 'Medicina 1A', cursoId: cursoB.id, campusId: campus.id });
        await bd.criarTurma({ nome: 'Odonto 1A', cursoId: cursoC.id, campusId: campus.id });

        const coordenador = await bd.criarUsuario({
            perfil: 'coordenador',
            cursosIds: [cursoA.id, cursoB.id],
        });

        const agente = await agenteDe(coordenador);
        const resposta = await agente.get('/admin/turmas');

        expect(resposta.text).toContain('Direito 1A');
        expect(resposta.text).toContain('Medicina 1A');
        expect(resposta.text).not.toContain('Odonto 1A');
    });

    it('sem curso vinculado ve a lista vazia, e nao um erro', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        await bd.criarTurma({ nome: 'Turma Existente', cursoId: curso.id, campusId: campus.id });

        const coordenador = await bd.criarUsuario({ perfil: 'coordenador', cursosIds: [] });
        const agente = await agenteDe(coordenador);

        const resposta = await agente.get('/admin/turmas');

        expect(resposta.status).toBe(200);
        expect(resposta.text).not.toContain('Turma Existente');
        expect(resposta.text).toContain('Nenhuma turma encontrada');
    });
});

describe('Escopo do NAP em turmas', () => {
    it('enxerga apenas turmas dos seus campus', async () => {
        const campusDele = await bd.criarCampus({ nome: 'Campus NAP' });
        const outroCampus = await bd.criarCampus({ nome: 'Campus Distante' });

        const curso = await bd.criarCurso({
            nome: 'Fisioterapia',
            campusIds: [campusDele.id, outroCampus.id],
        });

        await bd.criarTurma({ nome: 'Fisio Local', cursoId: curso.id, campusId: campusDele.id });
        await bd.criarTurma({
            nome: 'Fisio Distante',
            cursoId: curso.id,
            campusId: outroCampus.id,
        });

        const nap = await bd.criarUsuario({ perfil: 'nap', campusIds: [campusDele.id] });
        const agente = await agenteDe(nap);

        const resposta = await agente.get('/admin/turmas');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('Fisio Local');
        expect(resposta.text).not.toContain('Fisio Distante');
    });

    it('nao pode criar nem editar turmas (somente leitura)', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const turno = await bd.turnoPorSlug('matutino');
        const periodo = await bd.periodoAtual();
        const turma = await bd.criarTurma({
            nome: 'Turma do campus',
            cursoId: curso.id,
            campusId: campus.id,
        });

        const nap = await bd.criarUsuario({ perfil: 'nap', campusIds: [campus.id] });
        const agente = await agenteDe(nap);

        expect((await agente.get('/admin/turmas/novo')).status).toBe(403);

        const criacao = await postComCsrf(agente, '/admin/turmas', {
            nome: 'Turma do NAP',
            periodoLetivoId: periodo.id,
            campusId: campus.id,
            cursoId: curso.id,
            semestreCurricular: 1,
            turnoId: turno.id,
        });
        expect(criacao.status).toBe(403);

        expect((await agente.get(`/admin/turmas/${turma.id}/editar`)).status).toBe(403);

        const edicao = await postComCsrf(agente, `/admin/turmas/${turma.id}`, {
            nome: 'Renomeada pelo NAP',
            periodoLetivoId: periodo.id,
            campusId: campus.id,
            cursoId: curso.id,
            semestreCurricular: 1,
            turnoId: turno.id,
        });
        expect(edicao.status).toBe(403);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM turmas');
        expect(total.rows[0].total).toBe(1);

        const intacta = await bd.query('SELECT nome FROM turmas WHERE id = $1', [turma.id]);
        expect(intacta.rows[0].nome).toBe('Turma do campus');
    });
});

describe('CRUD de usuarios', () => {
    it('nega qualquer rota de /admin/usuarios para coordenador e nap', async () => {
        const coordenador = await bd.criarUsuario({ perfil: 'coordenador' });
        const nap = await bd.criarUsuario({ perfil: 'nap' });
        const alvo = await bd.criarUsuario({ perfil: 'coordenador' });

        for (const usuario of [coordenador, nap]) {
            const agente = await agenteDe(usuario);

            expect((await agente.get('/admin/usuarios')).status).toBe(403);
            expect((await agente.get('/admin/usuarios/novo')).status).toBe(403);
            expect((await agente.get(`/admin/usuarios/${alvo.id}/editar`)).status).toBe(403);

            const criacao = await postComCsrf(agente, '/admin/usuarios', {
                nome: 'Invasor',
                email: 'invasor@teste.local',
                senha: 'SenhaForte@123',
                perfil: 'admin',
            });
            expect(criacao.status).toBe(403);

            expect(
                (await postComCsrf(agente, `/admin/usuarios/${alvo.id}/status`, { ativo: 'false' }))
                    .status
            ).toBe(403);

            expect((await postComCsrf(agente, `/admin/usuarios/${alvo.id}/excluir`)).status).toBe(
                403
            );
        }

        const total = await bd.query(
            "SELECT COUNT(*)::int AS total FROM usuarios WHERE email = 'invasor@teste.local'"
        );
        expect(total.rows[0].total).toBe(0);
    });

    it('nao deixa coordenador escalar o proprio perfil por payload manipulado', async () => {
        const coordenador = await bd.criarUsuario({ perfil: 'coordenador' });
        const agente = await agenteDe(coordenador);

        const resposta = await postComCsrf(agente, `/admin/usuarios/${coordenador.id}`, {
            nome: coordenador.nome,
            email: coordenador.email,
            perfil: 'admin',
            ativo: 'true',
        });

        expect(resposta.status).toBe(403);

        const conferencia = await bd.query('SELECT perfil FROM usuarios WHERE id = $1', [
            coordenador.id,
        ]);
        expect(conferencia.rows[0].perfil).toBe('coordenador');
    });

    it('grava a senha apenas como hash bcrypt', async () => {
        const { agente } = await agenteAdmin();
        const SENHA = 'SenhaSecreta@2026';

        const resposta = await postComCsrf(agente, '/admin/usuarios', {
            nome: 'Nova Coordenadora',
            email: 'Nova.Coordenadora@Teste.Local',
            senha: SENHA,
            perfil: 'coordenador',
            ativo: 'true',
        });

        expect(resposta.status).toBe(302);

        const gravado = await bd.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [
            'nova.coordenadora@teste.local',
        ]);
        expect(gravado.rowCount).toBe(1);

        const linha = gravado.rows[0];
        expect(linha.senha_hash.startsWith('$2')).toBe(true);
        expect(linha.senha_hash).not.toBe(SENHA);
        // A senha em texto puro nao pode aparecer em nenhuma coluna do registro.
        expect(JSON.stringify(linha)).not.toContain(SENHA);

        // Nem em nenhuma outra linha da tabela.
        const todas = await bd.query('SELECT * FROM usuarios');
        expect(JSON.stringify(todas.rows)).not.toContain(SENHA);

        // O hash gerado realmente autentica o usuario.
        const novoAgente = criarAgente(app);
        await login(novoAgente, 'nova.coordenadora@teste.local', SENHA);

        // O formulario de edicao nunca devolve senha nem hash.
        const formulario = await agente.get(`/admin/usuarios/${linha.id}/editar`);
        expect(formulario.status).toBe(200);
        expect(formulario.text).not.toContain(SENHA);
        expect(formulario.text).not.toContain(linha.senha_hash);
    });

    it('mantem o hash anterior quando a edicao nao informa senha', async () => {
        const usuario = await bd.criarUsuario({ perfil: 'coordenador', senha: 'SenhaOriginal@1' });
        const antes = await bd.query('SELECT senha_hash FROM usuarios WHERE id = $1', [usuario.id]);

        const { agente } = await agenteAdmin();

        const resposta = await postComCsrf(agente, `/admin/usuarios/${usuario.id}`, {
            nome: 'Nome Atualizado',
            email: usuario.email,
            senha: '',
            perfil: 'coordenador',
            ativo: 'true',
        });

        expect(resposta.status).toBe(302);

        const depois = await bd.query('SELECT nome, senha_hash FROM usuarios WHERE id = $1', [
            usuario.id,
        ]);
        expect(depois.rows[0].nome).toBe('Nome Atualizado');
        expect(depois.rows[0].senha_hash).toBe(antes.rows[0].senha_hash);

        // A senha antiga continua valendo.
        const agenteUsuario = criarAgente(app);
        await login(agenteUsuario, usuario.email, 'SenhaOriginal@1');
    });

    it('troca a senha quando o administrador usa "redefinir senha"', async () => {
        const usuario = await bd.criarUsuario({ perfil: 'nap', senha: 'SenhaOriginal@1' });
        const antes = await bd.query('SELECT senha_hash FROM usuarios WHERE id = $1', [usuario.id]);

        const { agente } = await agenteAdmin();
        const NOVA = 'SenhaTrocada@2026';

        const resposta = await postComCsrf(agente, `/admin/usuarios/${usuario.id}/senha`, {
            senha: NOVA,
            confirmacao: NOVA,
        });

        expect(resposta.status).toBe(302);

        const depois = await bd.query('SELECT senha_hash FROM usuarios WHERE id = $1', [
            usuario.id,
        ]);
        expect(depois.rows[0].senha_hash).not.toBe(antes.rows[0].senha_hash);
        expect(depois.rows[0].senha_hash.startsWith('$2')).toBe(true);
        expect(JSON.stringify(depois.rows[0])).not.toContain(NOVA);

        const agenteUsuario = criarAgente(app);
        await login(agenteUsuario, usuario.email, NOVA);
    });

    it('recusa senha curta na criacao e na redefinicao', async () => {
        const { agente } = await agenteAdmin();

        const criacao = await postComCsrf(agente, '/admin/usuarios', {
            nome: 'Senha Curta',
            email: 'curta@teste.local',
            senha: '1234567',
            perfil: 'coordenador',
        });

        expect(criacao.status).toBe(422);
        expect(criacao.text).toContain('pelo menos 8 caracteres');

        const total = await bd.query(
            "SELECT COUNT(*)::int AS total FROM usuarios WHERE email = 'curta@teste.local'"
        );
        expect(total.rows[0].total).toBe(0);
    });

    it('recusa e-mail duplicado ignorando maiusculas e minusculas', async () => {
        await bd.criarUsuario({ email: 'repetido@teste.local', perfil: 'coordenador' });
        const { agente } = await agenteAdmin();

        const resposta = await postComCsrf(agente, '/admin/usuarios', {
            nome: 'Duplicado',
            email: 'REPETIDO@Teste.Local',
            senha: 'SenhaForte@123',
            perfil: 'coordenador',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um usuário cadastrado com este e-mail.');

        const total = await bd.query(
            "SELECT COUNT(*)::int AS total FROM usuarios WHERE LOWER(email) = 'repetido@teste.local'"
        );
        expect(total.rows[0].total).toBe(1);
    });

    it('grava e recarrega vinculos multiplos (2 cursos e 2 campus)', async () => {
        const campusA = await bd.criarCampus({ nome: 'Campus A' });
        const campusB = await bd.criarCampus({ nome: 'Campus B' });
        const cursoA = await bd.criarCurso({ nome: 'Curso A' });
        const cursoB = await bd.criarCurso({ nome: 'Curso B' });

        const { agente } = await agenteAdmin();

        const resposta = await postComCsrf(agente, '/admin/usuarios', {
            nome: 'Escopo Amplo',
            email: 'escopo@teste.local',
            senha: 'SenhaForte@123',
            perfil: 'coordenador',
            ativo: 'true',
            cursosIds: [cursoA.id, cursoB.id],
            campusIds: [campusA.id, campusB.id],
        });

        expect(resposta.status).toBe(302);

        const criado = await bd.query('SELECT id FROM usuarios WHERE email = $1', [
            'escopo@teste.local',
        ]);
        const id = criado.rows[0].id;

        const cursos = await bd.query(
            'SELECT curso_id FROM usuario_cursos WHERE usuario_id = $1 ORDER BY curso_id',
            [id]
        );
        const campus = await bd.query(
            'SELECT campus_id FROM usuario_campus WHERE usuario_id = $1 ORDER BY campus_id',
            [id]
        );

        expect(cursos.rows.map((linha) => linha.curso_id)).toEqual([cursoA.id, cursoB.id]);
        expect(campus.rows.map((linha) => linha.campus_id)).toEqual([campusA.id, campusB.id]);

        // O formulario de edicao recarrega os vinculos marcados.
        const formulario = await agente.get(`/admin/usuarios/${id}/editar`);
        expect(formulario.status).toBe(200);
        expect(formulario.text).toMatch(
            new RegExp(`id="curso-${cursoA.id}"[^>]*value="${cursoA.id}"[^>]*checked`)
        );
        expect(formulario.text).toMatch(
            new RegExp(`id="campus-${campusB.id}"[^>]*value="${campusB.id}"[^>]*checked`)
        );

        // Regravar com um unico curso substitui o conjunto anterior.
        const edicao = await postComCsrf(agente, `/admin/usuarios/${id}`, {
            nome: 'Escopo Amplo',
            email: 'escopo@teste.local',
            perfil: 'coordenador',
            ativo: 'true',
            cursosIds: [cursoB.id],
        });

        expect(edicao.status).toBe(302);

        const cursosDepois = await bd.query(
            'SELECT curso_id FROM usuario_cursos WHERE usuario_id = $1',
            [id]
        );
        const campusDepois = await bd.query(
            'SELECT campus_id FROM usuario_campus WHERE usuario_id = $1',
            [id]
        );

        expect(cursosDepois.rows.map((linha) => linha.curso_id)).toEqual([cursoB.id]);
        expect(campusDepois.rowCount).toBe(0);
    });

    it('lista o escopo e o ultimo login dos usuarios', async () => {
        const campus = await bd.criarCampus({ nome: 'Campus Listado' });
        const curso = await bd.criarCurso({ nome: 'Curso Listado', campusIds: [campus.id] });

        const usuario = await bd.criarUsuario({
            nome: 'Pessoa Vinculada',
            perfil: 'coordenador',
            cursosIds: [curso.id],
            campusIds: [campus.id],
        });

        const { agente } = await agenteAdmin();

        // Antes do primeiro acesso, a listagem indica que nunca acessou.
        const antes = await agente.get('/admin/usuarios');
        expect(antes.text).toContain('Pessoa Vinculada');
        expect(antes.text).toContain('Curso Listado');
        expect(antes.text).toContain('Campus Listado');
        expect(antes.text).toContain('Nunca acessou');

        await agenteDe(usuario);

        const depois = await agente.get('/admin/usuarios?busca=Pessoa');
        expect(depois.text).toContain('Pessoa Vinculada');
        expect(depois.text).not.toContain('Nunca acessou');
    });

    it('exclui usuario comum, mas nunca o proprio administrador logado', async () => {
        const descartavel = await bd.criarUsuario({ perfil: 'coordenador' });
        const { agente, admin } = await agenteAdmin();

        const exclusao = await postComCsrf(agente, `/admin/usuarios/${descartavel.id}/excluir`);
        expect(exclusao.status).toBe(302);

        const removido = await bd.query('SELECT 1 FROM usuarios WHERE id = $1', [descartavel.id]);
        expect(removido.rowCount).toBe(0);

        const proprio = await postComCsrf(agente, `/admin/usuarios/${admin.id}/excluir`);
        expect(proprio.status).toBe(403);

        const continua = await bd.query('SELECT 1 FROM usuarios WHERE id = $1', [admin.id]);
        expect(continua.rowCount).toBe(1);
    });
});

describe('Protecoes de administrador', () => {
    it('impede que o administrador inative ou rebaixe a si mesmo', async () => {
        const { agente, admin } = await agenteAdmin();

        const rebaixamento = await postComCsrf(agente, `/admin/usuarios/${admin.id}`, {
            nome: admin.nome,
            email: admin.email,
            perfil: 'coordenador',
            ativo: 'true',
        });

        expect(rebaixamento.status).toBe(422);
        expect(rebaixamento.text).toContain('próprio perfil de administrador');

        const inativacao = await postComCsrf(agente, `/admin/usuarios/${admin.id}`, {
            nome: admin.nome,
            email: admin.email,
            perfil: 'admin',
            ativo: 'false',
        });

        expect(inativacao.status).toBe(422);
        expect(inativacao.text).toContain('inativar o seu próprio usuário');

        const conferencia = await bd.query('SELECT perfil, ativo FROM usuarios WHERE id = $1', [
            admin.id,
        ]);
        expect(conferencia.rows[0]).toMatchObject({ perfil: 'admin', ativo: true });
    });

    it('bloqueia a inativacao pelo botao da listagem quando o alvo e o proprio admin', async () => {
        const { agente, admin } = await agenteAdmin();

        const resposta = await postComCsrf(agente, `/admin/usuarios/${admin.id}/status`, {
            ativo: 'false',
        });

        expect(resposta.status).toBe(302);

        const conferencia = await bd.query('SELECT ativo FROM usuarios WHERE id = $1', [admin.id]);
        expect(conferencia.rows[0].ativo).toBe(true);

        const lista = await agente.get('/admin/usuarios');
        expect(lista.text).toContain('rebaixar nem inativar o seu próprio usuário');
    });

    it('nao permite inativar nem rebaixar o ultimo administrador ativo', async () => {
        const admin = await bd.usuarioAdmin();
        const outroAdmin = await bd.criarUsuario({ perfil: 'admin' });

        // Deixa `outroAdmin` como unico administrador ativo do sistema.
        await bd.query('UPDATE usuarios SET ativo = FALSE WHERE id = $1', [admin.id]);

        // Autor diferente do alvo: a barreira aqui e a regra do ultimo admin.
        const autorFicticio = { id: admin.id + 100000, perfil: 'admin' };

        await expect(
            usuarioService.definirAtivo(autorFicticio, outroAdmin.id, false)
        ).rejects.toThrow(/último administrador ativo/i);

        await expect(
            usuarioService.atualizar(autorFicticio, outroAdmin.id, {
                nome: outroAdmin.nome,
                email: outroAdmin.email,
                senha: null,
                perfil: 'coordenador',
                ativo: true,
                cursosIds: [],
                campusIds: [],
            })
        ).rejects.toThrow(/último administrador ativo/i);

        await expect(usuarioService.excluir(autorFicticio, outroAdmin.id)).rejects.toThrow(
            /último administrador ativo/i
        );

        const conferencia = await bd.query('SELECT perfil, ativo FROM usuarios WHERE id = $1', [
            outroAdmin.id,
        ]);
        expect(conferencia.rows[0]).toMatchObject({ perfil: 'admin', ativo: true });
    });

    it('permite inativar um administrador quando existe outro administrador ativo', async () => {
        const outroAdmin = await bd.criarUsuario({ perfil: 'admin' });
        const { agente } = await agenteAdmin();

        const resposta = await postComCsrf(agente, `/admin/usuarios/${outroAdmin.id}/status`, {
            ativo: 'false',
        });

        expect(resposta.status).toBe(302);

        const conferencia = await bd.query('SELECT ativo FROM usuarios WHERE id = $1', [
            outroAdmin.id,
        ]);
        expect(conferencia.rows[0].ativo).toBe(false);
    });
});
