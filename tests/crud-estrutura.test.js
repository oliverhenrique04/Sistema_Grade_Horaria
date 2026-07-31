/**
 * Testes dos CRUDs estruturais: campus, turnos, horarios dos turnos e locais.
 *
 * Cobrem o caminho feliz, as regras que o banco garante (periodo de 50 minutos
 * e proibicao de sobreposicao), o bloqueio de exclusao/inativacao de registros
 * com historico e o controle de acesso por perfil e por campus.
 *
 * Execucao isolada (varios agentes trabalham no mesmo banco):
 *   NODE_ENV=test DB_SCHEMA=teste_estrutura npx jest tests/crud-estrutura.test.js --runInBand
 */
const path = require('node:path');
const express = require('express');

const bd = require('./helpers/db');
const { criarAgente, login, postComCsrf } = require('./helpers/app');
const horarioTurnoService = require('../src/services/horarioTurnoService');
const { ErroValidacao } = require('../src/utils/erros');

const SENHA = 'SenhaTeste@123';

let app;

/**
 * App com a mesma cadeia de middlewares de `src/app.js`, montando apenas as
 * rotas de estrutura.
 *
 * Usado somente quando `src/app.js` ainda nao carrega (outras rotas do painel
 * sendo escritas em paralelo). Mantem estes testes independentes do restante do
 * painel sem alterar o comportamento do que esta sob teste.
 * @returns {import('express').Express}
 */
const montarAppDeEstrutura = () => {
    const { aplicarSeguranca } = require('../src/middlewares/seguranca');
    const { criarMiddlewareSessao } = require('../src/middlewares/sessao');
    const { gerarToken, verificarCsrf } = require('../src/middlewares/csrf');
    const { carregarUsuario, exigirLogin } = require('../src/middlewares/autenticacao');
    const { contextoBase, flash } = require('../src/middlewares/contexto');
    const { periodoLetivoAtual } = require('../src/middlewares/periodoLetivo');
    const { montarMenu } = require('../src/middlewares/menu');
    const { naoEncontrado, tratadorGlobal } = require('../src/middlewares/erros');
    const rotasAutenticacao = require('../src/routes/autenticacao');

    const raiz = path.resolve(__dirname, '..');
    const aplicacao = express();

    aplicacao.set('trust proxy', true);
    aplicacao.set('view engine', 'ejs');
    aplicacao.set('views', path.join(raiz, 'src', 'views'));
    aplicacao.locals.basedir = path.join(raiz, 'src', 'views');

    aplicarSeguranca(aplicacao);
    aplicacao.use(express.static(path.join(raiz, 'public')));
    aplicacao.use(contextoBase);
    aplicacao.use(criarMiddlewareSessao());
    aplicacao.use(flash);
    aplicacao.use(gerarToken);
    aplicacao.use(carregarUsuario);
    aplicacao.use(periodoLetivoAtual);

    aplicacao.use('/', rotasAutenticacao);

    const painel = express.Router();
    painel.use(verificarCsrf);
    painel.use(montarMenu);
    painel.use('/campus', require('../src/routes/admin/campus'));
    painel.use('/turnos', require('../src/routes/admin/turnos'));
    painel.use('/horarios', require('../src/routes/admin/horarios'));
    painel.use('/locais', require('../src/routes/admin/locais'));
    aplicacao.use('/admin', exigirLogin, painel);

    aplicacao.use(naoEncontrado);
    aplicacao.use(tratadorGlobal);

    return aplicacao;
};

/**
 * Prefere a fabrica oficial `src/app.js`; cai para o app de estrutura enquanto
 * alguma outra rota do painel ainda nao existe.
 * @returns {import('express').Express}
 */
const montarApp = () => {
    try {
        return require('../src/app').criarApp();
    } catch (erro) {
        if (erro.code !== 'MODULE_NOT_FOUND') throw erro;
        console.warn(`[testes] usando app de estrutura isolado (${erro.message.split('\n')[0]}).`);
        return montarAppDeEstrutura();
    }
};

/**
 * Maiores ids da carga do seed. Tudo criado pelos testes acima desses valores e
 * removido entre um teste e outro (`limparDados` preserva turnos e horarios).
 */
let ultimoTurnoDoSeed = 0;
let ultimoHorarioDoSeed = 0;

/**
 * Limpa os dados de teste, inclusive turnos e horarios criados aqui.
 * @returns {Promise<void>}
 */
const limparEstrutura = async () => {
    await bd.limparDados();
    await bd.query('DELETE FROM horarios_turno WHERE id > $1 OR turno_id > $2', [
        ultimoHorarioDoSeed,
        ultimoTurnoDoSeed,
    ]);
    await bd.query('DELETE FROM turnos WHERE id > $1', [ultimoTurnoDoSeed]);
};

/**
 * Cria um agente autenticado com o perfil informado.
 * @param {{perfil?:string, cursosIds?:number[], campusIds?:number[]}} [opcoes]
 * @returns {Promise<{agente:object, usuario:object}>}
 */
const autenticar = async ({ perfil = 'admin', cursosIds = [], campusIds = [] } = {}) => {
    const usuario = await bd.criarUsuario({ perfil, senha: SENHA, cursosIds, campusIds });
    const agente = criarAgente(app);
    await login(agente, usuario.email, SENHA);
    return { agente, usuario };
};

/**
 * Cria um turno pelo painel e devolve a linha gravada.
 * @param {object} agente
 * @param {string} nome
 * @param {number} [ordem]
 * @returns {Promise<object>}
 */
const criarTurnoPeloPainel = async (agente, nome, ordem = 50) => {
    const resposta = await postComCsrf(agente, '/admin/turnos', { nome, ordem: String(ordem) });
    expect(resposta.status).toBe(302);

    const resultado = await bd.query('SELECT * FROM turnos WHERE nome = $1', [nome]);
    expect(resultado.rowCount).toBe(1);
    return resultado.rows[0];
};

/**
 * Cria um horario pelo painel.
 * @param {object} agente
 * @param {{turnoId:number, nome:string, ordem:number, inicio:string, fim:string,
 *          ativo?:string}} dados
 * @returns {Promise<import('supertest').Response>}
 */
const postHorario = (agente, { turnoId, nome, ordem, inicio, fim, ativo }) => {
    const corpo = {
        turno_id: String(turnoId),
        nome,
        ordem: String(ordem),
        hora_inicio: inicio,
        hora_fim: fim,
    };
    if (ativo !== undefined) corpo.ativo = ativo;
    return postComCsrf(agente, '/admin/horarios', corpo);
};

/**
 * Consome as mensagens flash pendentes (elas so somem quando uma pagina e
 * renderizada). Util antes de afirmar o que a proxima tela NAO deve conter.
 * @param {object} agente
 * @returns {Promise<void>}
 */
const limparMensagens = async (agente) => {
    await agente.get('/admin/campus');
};

/**
 * Le uma linha pelo id.
 * @param {string} tabela
 * @param {number} id
 * @returns {Promise<object|undefined>}
 */
const linhaPorId = async (tabela, id) => {
    const resultado = await bd.query(`SELECT * FROM ${tabela} WHERE id = $1`, [id]);
    return resultado.rows[0];
};

beforeAll(async () => {
    app = montarApp();

    const turnos = await bd.query('SELECT COALESCE(MAX(id), 0)::int AS maximo FROM turnos');
    ultimoTurnoDoSeed = turnos.rows[0].maximo;

    const horarios = await bd.query(
        'SELECT COALESCE(MAX(id), 0)::int AS maximo FROM horarios_turno'
    );
    ultimoHorarioDoSeed = horarios.rows[0].maximo;
});

beforeEach(async () => {
    await limparEstrutura();
});

afterAll(async () => {
    await limparEstrutura();
    await bd.encerrar();
});

// ---------------------------------------------------------------------------
// Acesso
// ---------------------------------------------------------------------------
describe('acesso as telas de estrutura', () => {
    test('usuario nao autenticado e redirecionado para /login', async () => {
        const agente = criarAgente(app);

        for (const caminho of [
            '/admin/campus',
            '/admin/turnos',
            '/admin/horarios',
            '/admin/locais',
        ]) {
            const resposta = await agente.get(caminho);
            expect(resposta.status).toBe(302);
            expect(resposta.headers.location).toContain('/login');
        }
    });

    test('POST sem sessao tambem nao passa', async () => {
        const agente = criarAgente(app);
        const resposta = await agente.post('/admin/campus').type('form').send({ nome: 'X' });

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toContain('/login');

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM campus');
        expect(total.rows[0].total).toBe(0);
    });

    test('coordenador le campus mas nao consegue criar (403)', async () => {
        const { agente } = await autenticar({ perfil: 'coordenador' });

        const leitura = await agente.get('/admin/campus');
        expect(leitura.status).toBe(200);

        const formulario = await agente.get('/admin/campus/novo');
        expect(formulario.status).toBe(403);

        const criacao = await postComCsrf(agente, '/admin/campus', {
            nome: 'Campus Proibido',
            sigla: 'CP',
        });
        expect(criacao.status).toBe(403);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM campus');
        expect(total.rows[0].total).toBe(0);
    });

    test('coordenador nao inativa nem exclui turno', async () => {
        const { agente: admin } = await autenticar({ perfil: 'admin' });
        const turno = await criarTurnoPeloPainel(admin, 'Teste Vespertino Extra');

        const { agente } = await autenticar({ perfil: 'coordenador' });

        const situacao = await postComCsrf(agente, `/admin/turnos/${turno.id}/situacao`, {
            ativo: '0',
        });
        expect(situacao.status).toBe(403);

        const exclusao = await postComCsrf(agente, `/admin/turnos/${turno.id}/excluir`, {});
        expect(exclusao.status).toBe(403);

        expect((await linhaPorId('turnos', turno.id)).ativo).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Campus
// ---------------------------------------------------------------------------
describe('CRUD de campus', () => {
    test('cria e edita um campus', async () => {
        const { agente } = await autenticar();

        const criacao = await postComCsrf(agente, '/admin/campus', {
            nome: 'Campus Central',
            sigla: 'CC',
            ativo: '1',
        });
        expect(criacao.status).toBe(302);

        const criado = await bd.query('SELECT * FROM campus WHERE nome = $1', ['Campus Central']);
        expect(criado.rowCount).toBe(1);
        expect(criado.rows[0].sigla).toBe('CC');
        expect(criado.rows[0].ativo).toBe(true);

        const id = criado.rows[0].id;

        const edicao = await postComCsrf(agente, `/admin/campus/${id}`, {
            nome: 'Campus Central II',
            sigla: 'CCII',
            ativo: '1',
        });
        expect(edicao.status).toBe(302);

        const atualizado = await linhaPorId('campus', id);
        expect(atualizado.nome).toBe('Campus Central II');
        expect(atualizado.sigla).toBe('CCII');

        // A tela de edicao devolve os valores gravados.
        const formulario = await agente.get(`/admin/campus/${id}/editar`);
        expect(formulario.status).toBe(200);
        expect(formulario.text).toContain('Campus Central II');
    });

    test('ignora campos fora do formulario (mass assignment)', async () => {
        const { agente } = await autenticar();

        const resposta = await postComCsrf(agente, '/admin/campus', {
            nome: 'Campus Blindado',
            sigla: 'CB',
            id: '999',
            criado_em: '1900-01-01',
        });
        expect(resposta.status).toBe(302);

        const criado = await bd.query('SELECT * FROM campus WHERE nome = $1', ['Campus Blindado']);
        expect(criado.rows[0].id).not.toBe(999);
        expect(new Date(criado.rows[0].criado_em).getFullYear()).toBeGreaterThan(2000);
    });

    test('recusa nome duplicado e devolve o valor digitado', async () => {
        const { agente } = await autenticar();
        await bd.criarCampus({ nome: 'Campus Único', sigla: 'CU' });

        const resposta = await postComCsrf(agente, '/admin/campus', {
            nome: 'Campus Único',
            sigla: 'CU2',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um campus com este nome.');
        // Reexibe o que foi digitado.
        expect(resposta.text).toContain('Campus Único');
        expect(resposta.text).toContain('CU2');

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM campus');
        expect(total.rows[0].total).toBe(1);
    });

    test('a unicidade do nome ignora maiusculas e minusculas', async () => {
        const { agente } = await autenticar();
        await bd.criarCampus({ nome: 'Campus Norte' });

        const resposta = await postComCsrf(agente, '/admin/campus', { nome: 'campus norte' });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um campus com este nome.');
    });

    test('exige o nome', async () => {
        const { agente } = await autenticar();
        const resposta = await postComCsrf(agente, '/admin/campus', { nome: '   ', sigla: 'XX' });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Informe o nome do campus.');
    });

    test('inativa e reativa um campus', async () => {
        const { agente } = await autenticar();
        const campus = await bd.criarCampus();

        const inativacao = await postComCsrf(agente, `/admin/campus/${campus.id}/situacao`, {
            ativo: '0',
        });
        expect(inativacao.status).toBe(302);
        expect((await linhaPorId('campus', campus.id)).ativo).toBe(false);

        const reativacao = await postComCsrf(agente, `/admin/campus/${campus.id}/situacao`, {
            ativo: '1',
        });
        expect(reativacao.status).toBe(302);
        expect((await linhaPorId('campus', campus.id)).ativo).toBe(true);
    });

    test('nao inativa campus com turmas ativas e explica o motivo', async () => {
        const { agente } = await autenticar();
        const campus = await bd.criarCampus({ nome: 'Campus Com Turma' });
        await bd.criarTurma({ campusId: campus.id });

        const resposta = await postComCsrf(agente, `/admin/campus/${campus.id}/situacao`, {
            ativo: '0',
        });

        expect(resposta.status).toBe(302);
        expect((await linhaPorId('campus', campus.id)).ativo).toBe(true);

        const lista = await agente.get('/admin/campus');
        expect(lista.text).toContain('Não é possível inativar o campus');
        expect(lista.text).toContain('Campus Com Turma');
    });

    test('nao exclui campus com vinculos e orienta a inativacao', async () => {
        const { agente } = await autenticar();
        const campus = await bd.criarCampus({ nome: 'Campus Com Local' });
        await bd.criarLocal({ campusId: campus.id });

        const resposta = await postComCsrf(agente, `/admin/campus/${campus.id}/excluir`, {});

        expect(resposta.status).toBe(302);
        expect(await linhaPorId('campus', campus.id)).toBeDefined();

        const lista = await agente.get('/admin/campus');
        expect(lista.text).toContain('Não é possível excluir o campus');
        expect(lista.text).toContain('Inative o campus');
    });

    test('exclui campus sem nenhum vinculo', async () => {
        const { agente } = await autenticar();
        const campus = await bd.criarCampus({ nome: 'Campus Solto' });

        const resposta = await postComCsrf(agente, `/admin/campus/${campus.id}/excluir`, {});

        expect(resposta.status).toBe(302);
        expect(await linhaPorId('campus', campus.id)).toBeUndefined();
    });

    test('a lista mostra a contagem de locais e turmas e filtra por situacao', async () => {
        const { agente } = await autenticar();
        const campus = await bd.criarCampus({ nome: 'Campus Contado' });
        await bd.criarLocal({ campusId: campus.id });
        await bd.criarLocal({ campusId: campus.id });
        await bd.criarTurma({ campusId: campus.id });
        await bd.criarCampus({ nome: 'Campus Desligado', ativo: false });

        const todos = await agente.get('/admin/campus');
        expect(todos.text).toContain('Campus Contado');
        expect(todos.text).toContain('Campus Desligado');

        const ativos = await agente.get('/admin/campus?ativo=1');
        expect(ativos.text).toContain('Campus Contado');
        expect(ativos.text).not.toContain('Campus Desligado');

        const busca = await agente.get('/admin/campus?busca=Desligado');
        expect(busca.text).toContain('Campus Desligado');
        expect(busca.text).not.toContain('Campus Contado');
    });
});

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------
describe('CRUD de turnos', () => {
    test('cria turno gerando o slug a partir do nome', async () => {
        const { agente } = await autenticar();

        const resposta = await postComCsrf(agente, '/admin/turnos', {
            nome: 'Teste Integral Ampliado',
            ordem: '40',
        });
        expect(resposta.status).toBe(302);

        const criado = await bd.query('SELECT * FROM turnos WHERE nome = $1', [
            'Teste Integral Ampliado',
        ]);
        expect(criado.rows[0].slug).toBe('teste-integral-ampliado');
        expect(criado.rows[0].icone).toBe('fa-clock');
        expect(criado.rows[0].ordem).toBe(40);
    });

    test('recusa nome e slug duplicados', async () => {
        const { agente } = await autenticar();
        await criarTurnoPeloPainel(agente, 'Teste Duplicado');

        const porNome = await postComCsrf(agente, '/admin/turnos', { nome: 'Teste Duplicado' });
        expect(porNome.status).toBe(422);
        expect(porNome.text).toContain('Já existe um turno com este nome.');

        const porSlug = await postComCsrf(agente, '/admin/turnos', {
            nome: 'Outro nome qualquer',
            slug: 'teste-duplicado',
        });
        expect(porSlug.status).toBe(422);
        expect(porSlug.text).toContain('Já existe um turno com este identificador.');
    });

    test('recusa slug com formato invalido', async () => {
        const { agente } = await autenticar();

        const resposta = await postComCsrf(agente, '/admin/turnos', {
            nome: 'Teste Slug',
            slug: 'Slug Inválido!',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('letras minúsculas');
    });

    test('aceita qualquer quantidade de horarios em um turno', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Jornada Longa');

        // Oito periodos de 50 minutos, um por hora cheia a partir das 07:00.
        for (let ordem = 1; ordem <= 8; ordem += 1) {
            const hora = String(6 + ordem).padStart(2, '0');
            const resposta = await postHorario(agente, {
                turnoId: turno.id,
                nome: `${ordem}º horário`,
                ordem,
                inicio: `${hora}:00`,
                fim: `${hora}:50`,
            });
            expect(resposta.status).toBe(302);
        }

        const total = await bd.query(
            'SELECT COUNT(*)::int AS total FROM horarios_turno WHERE turno_id = $1',
            [turno.id]
        );
        expect(total.rows[0].total).toBe(8);

        await limparMensagens(agente);

        // A lista de turnos exibe a contagem vinda do banco, nao um valor fixo.
        const lista = await agente.get('/admin/turnos?busca=Jornada');
        expect(lista.status).toBe(200);
        expect(lista.text).toContain('Teste Jornada Longa');
        expect(lista.text).toMatch(
            new RegExp(`/admin/horarios\\?turno_id=${turno.id}"[\\s\\S]{0,300}?>\\s*8\\s*<`)
        );

        const horarios = await agente.get(`/admin/horarios?turno_id=${turno.id}`);
        expect(horarios.text).toContain('8º horário');
    });

    test('inativa e reativa um turno sem turmas', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Reversivel');

        await postComCsrf(agente, `/admin/turnos/${turno.id}/situacao`, { ativo: '0' });
        expect((await linhaPorId('turnos', turno.id)).ativo).toBe(false);

        await postComCsrf(agente, `/admin/turnos/${turno.id}/situacao`, { ativo: '1' });
        expect((await linhaPorId('turnos', turno.id)).ativo).toBe(true);
    });

    test('nao inativa nem exclui turno com turmas vinculadas', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Com Turmas');
        await bd.criarTurma({ turnoId: turno.id });

        const inativacao = await postComCsrf(agente, `/admin/turnos/${turno.id}/situacao`, {
            ativo: '0',
        });
        expect(inativacao.status).toBe(302);
        expect((await linhaPorId('turnos', turno.id)).ativo).toBe(true);

        const exclusao = await postComCsrf(agente, `/admin/turnos/${turno.id}/excluir`, {});
        expect(exclusao.status).toBe(302);
        expect(await linhaPorId('turnos', turno.id)).toBeDefined();

        const lista = await agente.get('/admin/turnos');
        expect(lista.text).toContain('turma(s)');
    });

    test('nao exclui turno que ainda tem horarios cadastrados', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Com Horarios');
        await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });

        const resposta = await postComCsrf(agente, `/admin/turnos/${turno.id}/excluir`, {});
        expect(resposta.status).toBe(302);
        expect(await linhaPorId('turnos', turno.id)).toBeDefined();

        const lista = await agente.get('/admin/turnos');
        expect(lista.text).toContain('horário(s) cadastrado(s)');
    });

    test('exclui turno sem horarios nem turmas', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Descartavel');

        const resposta = await postComCsrf(agente, `/admin/turnos/${turno.id}/excluir`, {});
        expect(resposta.status).toBe(302);
        expect(await linhaPorId('turnos', turno.id)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Horarios dos turnos
// ---------------------------------------------------------------------------
describe('CRUD de horarios dos turnos', () => {
    test('aceita periodo de exatamente 50 minutos', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Cinquenta');

        const resposta = await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:10',
            fim: '08:00',
        });

        expect(resposta.status).toBe(302);

        const criado = await bd.query(
            'SELECT * FROM horarios_turno WHERE turno_id = $1 AND ordem = 1',
            [turno.id]
        );
        expect(criado.rowCount).toBe(1);
        expect(criado.rows[0].hora_inicio).toBe('07:10:00');
        expect(criado.rows[0].hora_fim).toBe('08:00:00');
    });

    test('recusa duracao diferente de 50 minutos com mensagem amigavel', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Duracao');

        const resposta = await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '08:00',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.status).not.toBe(500);
        expect(resposta.text).toContain('50 minutos');
        // Nao vazou pagina de erro interno.
        expect(resposta.text).not.toContain('Erro interno');

        const total = await bd.query(
            'SELECT COUNT(*)::int AS total FROM horarios_turno WHERE turno_id = $1',
            [turno.id]
        );
        expect(total.rows[0].total).toBe(0);
    });

    test('recusa termino anterior ao inicio', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Invertido');

        const resposta = await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '08:00',
            fim: '07:10',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('posterior à hora de início');
    });

    test('o CHECK do banco vira erro de campo, nunca 500', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Check Banco');

        // Chamada direta ao servico (sem passar pelo validator do formulario):
        // garante que o erro do CHECK `ck_horario_duracao_50min` e traduzido.
        await expect(
            horarioTurnoService.criar({
                turno_id: turno.id,
                nome: 'Horário longo',
                ordem: 1,
                hora_inicio: '07:00',
                hora_fim: '09:30',
                ativo: true,
            })
        ).rejects.toBeInstanceOf(ErroValidacao);

        try {
            await horarioTurnoService.criar({
                turno_id: turno.id,
                nome: 'Horário longo',
                ordem: 2,
                hora_inicio: '07:00',
                hora_fim: '09:30',
                ativo: true,
            });
        } catch (erro) {
            expect(erro.status).toBe(422);
            expect(erro.message).toContain('50 minutos');
            expect(erro.campos.hora_fim).toContain('50 minutos');
        }
    });

    test('recusa sobreposicao entre periodos ativos do mesmo turno', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Sobreposto');

        const primeiro = await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });
        expect(primeiro.status).toBe(302);

        const segundo = await postHorario(agente, {
            turnoId: turno.id,
            nome: '2º horário',
            ordem: 2,
            inicio: '07:30',
            fim: '08:20',
        });

        expect(segundo.status).toBe(422);
        expect(segundo.status).not.toBe(500);
        expect(segundo.text).toContain('se sobrep');
        expect(segundo.text).toContain('1º horário');

        const total = await bd.query(
            'SELECT COUNT(*)::int AS total FROM horarios_turno WHERE turno_id = $1',
            [turno.id]
        );
        expect(total.rows[0].total).toBe(1);
    });

    test('aceita intervalo (lacuna) entre periodos', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Com Intervalo');

        const primeiro = await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });
        expect(primeiro.status).toBe(302);

        // Dez minutos de intervalo antes do periodo seguinte.
        const segundo = await postHorario(agente, {
            turnoId: turno.id,
            nome: '2º horário',
            ordem: 2,
            inicio: '08:00',
            fim: '08:50',
        });
        expect(segundo.status).toBe(302);

        const total = await bd.query(
            'SELECT COUNT(*)::int AS total FROM horarios_turno WHERE turno_id = $1',
            [turno.id]
        );
        expect(total.rows[0].total).toBe(2);
    });

    test('periodos inativos nao entram na verificacao de sobreposicao', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Inativo Sobrepoe');

        await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
            ativo: '0',
        });

        const resposta = await postHorario(agente, {
            turnoId: turno.id,
            nome: '2º horário',
            ordem: 2,
            inicio: '07:10',
            fim: '08:00',
        });

        expect(resposta.status).toBe(302);
    });

    test('recusa ordem repetida no mesmo turno', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Ordem');

        await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });

        const resposta = await postHorario(agente, {
            turnoId: turno.id,
            nome: 'Outro horário',
            ordem: 1,
            inicio: '09:00',
            fim: '09:50',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Já existe um horário com esta ordem neste turno.');
    });

    test('exige turno valido', async () => {
        const { agente } = await autenticar();

        const semTurno = await postComCsrf(agente, '/admin/horarios', {
            nome: '1º horário',
            ordem: '1',
            hora_inicio: '07:00',
            hora_fim: '07:50',
        });
        expect(semTurno.status).toBe(422);
        expect(semTurno.text).toContain('Selecione o turno.');

        const turnoInexistente = await postHorario(agente, {
            turnoId: 999999,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });
        expect(turnoInexistente.status).toBe(422);
        expect(turnoInexistente.text).toContain('Selecione um turno válido.');
    });

    test('edita, inativa e reativa um horario', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Edicao Horario');
        await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });

        const criado = await bd.query('SELECT * FROM horarios_turno WHERE turno_id = $1', [
            turno.id,
        ]);
        const horario = criado.rows[0];

        const edicao = await postComCsrf(agente, `/admin/horarios/${horario.id}`, {
            turno_id: String(turno.id),
            nome: '1º horário (manhã)',
            ordem: '1',
            hora_inicio: '07:20',
            hora_fim: '08:10',
            ativo: '1',
        });
        expect(edicao.status).toBe(302);

        const atualizado = await linhaPorId('horarios_turno', horario.id);
        expect(atualizado.nome).toBe('1º horário (manhã)');
        expect(atualizado.hora_inicio).toBe('07:20:00');

        await postComCsrf(agente, `/admin/horarios/${horario.id}/situacao`, { ativo: '0' });
        expect((await linhaPorId('horarios_turno', horario.id)).ativo).toBe(false);

        await postComCsrf(agente, `/admin/horarios/${horario.id}/situacao`, { ativo: '1' });
        expect((await linhaPorId('horarios_turno', horario.id)).ativo).toBe(true);
    });

    test('horario usado em aulas nao pode ser excluido, apenas inativado', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Horario Em Uso');
        await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '19:00',
            fim: '19:50',
        });

        const criado = await bd.query('SELECT * FROM horarios_turno WHERE turno_id = $1', [
            turno.id,
        ]);
        const horario = criado.rows[0];

        const turma = await bd.criarTurma({ turnoId: turno.id });
        await bd.criarAula({ turmaId: turma.id, horarioTurnoId: horario.id });

        const exclusao = await postComCsrf(agente, `/admin/horarios/${horario.id}/excluir`, {});
        expect(exclusao.status).toBe(302);
        expect(await linhaPorId('horarios_turno', horario.id)).toBeDefined();

        const lista = await agente.get('/admin/horarios');
        expect(lista.text).toContain('Não é possível excluir o horário');
        expect(lista.text).toContain('Inative o horário');

        // A alternativa oferecida funciona.
        const inativacao = await postComCsrf(agente, `/admin/horarios/${horario.id}/situacao`, {
            ativo: '0',
        });
        expect(inativacao.status).toBe(302);
        expect((await linhaPorId('horarios_turno', horario.id)).ativo).toBe(false);
    });

    test('exclui horario que nunca foi usado', async () => {
        const { agente } = await autenticar();
        const turno = await criarTurnoPeloPainel(agente, 'Teste Horario Livre');
        await postHorario(agente, {
            turnoId: turno.id,
            nome: '1º horário',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });

        const criado = await bd.query('SELECT * FROM horarios_turno WHERE turno_id = $1', [
            turno.id,
        ]);

        const resposta = await postComCsrf(
            agente,
            `/admin/horarios/${criado.rows[0].id}/excluir`,
            {}
        );
        expect(resposta.status).toBe(302);
        expect(await linhaPorId('horarios_turno', criado.rows[0].id)).toBeUndefined();
    });

    test('a lista filtra por turno', async () => {
        const { agente } = await autenticar();
        const turnoA = await criarTurnoPeloPainel(agente, 'Teste Filtro A', 51);
        const turnoB = await criarTurnoPeloPainel(agente, 'Teste Filtro B', 52);

        await postHorario(agente, {
            turnoId: turnoA.id,
            nome: 'Horário do A',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });
        await postHorario(agente, {
            turnoId: turnoB.id,
            nome: 'Horário do B',
            ordem: 1,
            inicio: '07:00',
            fim: '07:50',
        });

        // Sem isto as mensagens de sucesso das criacoes apareceriam na pagina.
        await limparMensagens(agente);

        const somenteA = await agente.get(`/admin/horarios?turno_id=${turnoA.id}`);
        expect(somenteA.status).toBe(200);
        expect(somenteA.text).toContain('Horário do A');
        expect(somenteA.text).not.toContain('Horário do B');
    });
});

// ---------------------------------------------------------------------------
// Locais
// ---------------------------------------------------------------------------
describe('CRUD de locais', () => {
    test('cria local vinculado a um campus', async () => {
        const { agente } = await autenticar();
        const campus = await bd.criarCampus({ nome: 'Campus Dos Locais' });

        const resposta = await postComCsrf(agente, '/admin/locais', {
            campus_id: String(campus.id),
            nome: 'Laboratório 1',
            codigo: 'LAB1',
            tipo: 'laboratorio',
            capacidade: '30',
        });
        expect(resposta.status).toBe(302);

        const criado = await bd.query('SELECT * FROM locais WHERE nome = $1', ['Laboratório 1']);
        expect(criado.rowCount).toBe(1);
        expect(criado.rows[0].campus_id).toBe(campus.id);
        expect(criado.rows[0].tipo).toBe('laboratorio');
        expect(criado.rows[0].capacidade).toBe(30);
    });

    test('exige campus', async () => {
        const { agente } = await autenticar();

        const resposta = await postComCsrf(agente, '/admin/locais', { nome: 'Sala Sem Campus' });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Selecione o campus.');

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM locais');
        expect(total.rows[0].total).toBe(0);
    });

    test('recusa campus inexistente', async () => {
        const { agente } = await autenticar();

        const resposta = await postComCsrf(agente, '/admin/locais', {
            campus_id: '999999',
            nome: 'Sala Fantasma',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Selecione um campus válido.');
    });

    test('recusa nome repetido no mesmo campus e aceita em outro', async () => {
        const { agente } = await autenticar();
        const campusA = await bd.criarCampus({ nome: 'Campus A' });
        const campusB = await bd.criarCampus({ nome: 'Campus B' });
        await bd.criarLocal({ campusId: campusA.id, nome: 'Sala 101' });

        const repetido = await postComCsrf(agente, '/admin/locais', {
            campus_id: String(campusA.id),
            nome: 'Sala 101',
        });
        expect(repetido.status).toBe(422);
        expect(repetido.text).toContain('Já existe um local com este nome neste campus.');

        const outroCampus = await postComCsrf(agente, '/admin/locais', {
            campus_id: String(campusB.id),
            nome: 'Sala 101',
        });
        expect(outroCampus.status).toBe(302);
    });

    test('edita, inativa e reativa um local', async () => {
        const { agente } = await autenticar();
        const local = await bd.criarLocal({ nome: 'Sala Original' });

        const edicao = await postComCsrf(agente, `/admin/locais/${local.id}`, {
            campus_id: String(local.campus_id),
            nome: 'Sala Renomeada',
            codigo: 'S-R',
            tipo: 'auditorio',
            capacidade: '120',
            ativo: '1',
        });
        expect(edicao.status).toBe(302);

        const atualizado = await linhaPorId('locais', local.id);
        expect(atualizado.nome).toBe('Sala Renomeada');
        expect(atualizado.tipo).toBe('auditorio');
        expect(atualizado.capacidade).toBe(120);

        await postComCsrf(agente, `/admin/locais/${local.id}/situacao`, { ativo: '0' });
        expect((await linhaPorId('locais', local.id)).ativo).toBe(false);

        await postComCsrf(agente, `/admin/locais/${local.id}/situacao`, { ativo: '1' });
        expect((await linhaPorId('locais', local.id)).ativo).toBe(true);
    });

    test('recusa capacidade negativa', async () => {
        const { agente } = await autenticar();
        const campus = await bd.criarCampus();

        const resposta = await postComCsrf(agente, '/admin/locais', {
            campus_id: String(campus.id),
            nome: 'Sala Negativa',
            capacidade: '-5',
        });

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('capacidade não pode ser negativa');
    });

    test('local usado em aulas nao pode ser excluido', async () => {
        const { agente } = await autenticar();
        const local = await bd.criarLocal({ nome: 'Sala Ocupada' });
        await bd.criarAula({ localId: local.id });

        const resposta = await postComCsrf(agente, `/admin/locais/${local.id}/excluir`, {});

        expect(resposta.status).toBe(302);
        expect(await linhaPorId('locais', local.id)).toBeDefined();

        const lista = await agente.get('/admin/locais');
        expect(lista.text).toContain('Não é possível excluir o local');
        expect(lista.text).toContain('Inative o local');
    });

    test('exclui local nunca usado', async () => {
        const { agente } = await autenticar();
        const local = await bd.criarLocal({ nome: 'Sala Vazia' });

        const resposta = await postComCsrf(agente, `/admin/locais/${local.id}/excluir`, {});
        expect(resposta.status).toBe(302);
        expect(await linhaPorId('locais', local.id)).toBeUndefined();
    });

    test('a lista filtra por campus, tipo e busca', async () => {
        const { agente } = await autenticar();
        const campusA = await bd.criarCampus({ nome: 'Campus Filtro A' });
        const campusB = await bd.criarCampus({ nome: 'Campus Filtro B' });

        await bd.criarLocal({ campusId: campusA.id, nome: 'Sala Alfa', tipo: 'sala' });
        await bd.criarLocal({ campusId: campusB.id, nome: 'Lab Beta', tipo: 'laboratorio' });

        const porCampus = await agente.get(`/admin/locais?campus_id=${campusA.id}`);
        expect(porCampus.text).toContain('Sala Alfa');
        expect(porCampus.text).not.toContain('Lab Beta');

        const porTipo = await agente.get('/admin/locais?tipo=laboratorio');
        expect(porTipo.text).toContain('Lab Beta');
        expect(porTipo.text).not.toContain('Sala Alfa');

        const porBusca = await agente.get('/admin/locais?busca=Alfa');
        expect(porBusca.text).toContain('Sala Alfa');
        expect(porBusca.text).not.toContain('Lab Beta');
    });
});

// ---------------------------------------------------------------------------
// Escopo de campus do perfil NAP
// ---------------------------------------------------------------------------
describe('escopo de campus do perfil NAP', () => {
    test('nap cria local no proprio campus e recebe 403 em campus alheio', async () => {
        const campusDele = await bd.criarCampus({ nome: 'Campus do NAP' });
        const campusAlheio = await bd.criarCampus({ nome: 'Campus Alheio' });

        const { agente } = await autenticar({ perfil: 'nap', campusIds: [campusDele.id] });

        const permitido = await postComCsrf(agente, '/admin/locais', {
            campus_id: String(campusDele.id),
            nome: 'Sala do NAP',
        });
        expect(permitido.status).toBe(302);

        const proibido = await postComCsrf(agente, '/admin/locais', {
            campus_id: String(campusAlheio.id),
            nome: 'Sala Invadida',
        });
        expect(proibido.status).toBe(403);

        const total = await bd.query('SELECT COUNT(*)::int AS total FROM locais WHERE nome = $1', [
            'Sala Invadida',
        ]);
        expect(total.rows[0].total).toBe(0);
    });

    test('nap so enxerga locais e campus do proprio escopo', async () => {
        const campusDele = await bd.criarCampus({ nome: 'Campus Visivel' });
        const campusAlheio = await bd.criarCampus({ nome: 'Campus Invisivel' });

        await bd.criarLocal({ campusId: campusDele.id, nome: 'Sala Visivel' });
        await bd.criarLocal({ campusId: campusAlheio.id, nome: 'Sala Invisivel' });

        const { agente } = await autenticar({ perfil: 'nap', campusIds: [campusDele.id] });

        const lista = await agente.get('/admin/locais');
        expect(lista.status).toBe(200);
        expect(lista.text).toContain('Sala Visivel');
        expect(lista.text).not.toContain('Sala Invisivel');

        // O select do formulario tambem so oferece os campus do escopo.
        const formulario = await agente.get('/admin/locais/novo');
        expect(formulario.status).toBe(200);
        expect(formulario.text).toContain('Campus Visivel');
        expect(formulario.text).not.toContain('Campus Invisivel');
    });

    test('nap nao edita nem inativa local de campus alheio', async () => {
        const campusDele = await bd.criarCampus();
        const campusAlheio = await bd.criarCampus();
        const alheio = await bd.criarLocal({ campusId: campusAlheio.id, nome: 'Sala Alheia' });

        const { agente } = await autenticar({ perfil: 'nap', campusIds: [campusDele.id] });

        const edicao = await agente.get(`/admin/locais/${alheio.id}/editar`);
        expect(edicao.status).toBe(403);

        const gravacao = await postComCsrf(agente, `/admin/locais/${alheio.id}`, {
            campus_id: String(campusAlheio.id),
            nome: 'Sala Sequestrada',
        });
        expect(gravacao.status).toBe(403);

        const situacao = await postComCsrf(agente, `/admin/locais/${alheio.id}/situacao`, {
            ativo: '0',
        });
        expect(situacao.status).toBe(403);

        const atual = await linhaPorId('locais', alheio.id);
        expect(atual.nome).toBe('Sala Alheia');
        expect(atual.ativo).toBe(true);
    });

    test('nap le campus, turnos e horarios mas nao os altera', async () => {
        const campus = await bd.criarCampus();
        const { agente } = await autenticar({ perfil: 'nap', campusIds: [campus.id] });

        for (const caminho of ['/admin/campus', '/admin/turnos', '/admin/horarios']) {
            const resposta = await agente.get(caminho);
            expect(resposta.status).toBe(200);
        }

        const criacao = await postComCsrf(agente, '/admin/campus', { nome: 'Campus do NAP' });
        expect(criacao.status).toBe(403);
    });
});
