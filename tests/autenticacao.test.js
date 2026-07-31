/**
 * Testes de autenticacao e autorizacao.
 *
 * Cobrem o fluxo completo de login por sessao (que substituiu o antigo acesso
 * por token na URL), a protecao CSRF, o bloqueio de open redirect e a matriz de
 * permissoes/escopo.
 */
const config = require('../src/config/env');
const bd = require('./helpers/db');
const {
    criarApp,
    criarAgente,
    login,
    tentarLogin,
    tokenCsrf,
    postComCsrf,
} = require('./helpers/app');

const autorizacao = require('../src/middlewares/autorizacao');
const escopoService = require('../src/services/escopoService');
const autenticacaoService = require('../src/services/autenticacaoService');

const SENHA = 'SenhaTeste@123';

let app;

/**
 * Extrai o sid da sessao a partir do cabecalho Set-Cookie da resposta.
 * @param {import('supertest').Response} resposta
 * @returns {string|null}
 */
const sidDaResposta = (resposta) => {
    const cabecalho = resposta.headers['set-cookie'];
    if (!Array.isArray(cabecalho)) return null;

    const cookie = cabecalho.find((linha) => linha.startsWith(`${config.sessao.nomeCookie}=`));
    if (!cookie) return null;

    const valor = decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
    if (!valor) return null;

    return valor.startsWith('s:') ? valor.slice(2).split('.')[0] : valor;
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

describe('login', () => {
    test('autentica com credenciais validas, cria sessao e registra o ultimo login', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, perfil: 'admin' });
        const agente = criarAgente(app);

        const resposta = await tentarLogin(agente, usuario.email, SENHA);

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe('/admin');

        // Sessao ativa: a tela de login passa a redirecionar para o painel.
        const telaLogin = await agente.get('/login');
        expect(telaLogin.status).toBe(302);
        expect(telaLogin.headers.location).toBe('/admin');

        // E o painel deixa de mandar de volta para o login.
        const painel = await agente.get('/admin');
        expect(painel.headers.location || '').not.toContain('/login');
        expect(painel.status).toBeLessThan(400);

        const registro = await bd.query('SELECT ultimo_login_em FROM usuarios WHERE id = $1', [
            usuario.id,
        ]);
        expect(registro.rows[0].ultimo_login_em).not.toBeNull();
    });

    test('aceita e-mail com diferenca de maiusculas e espacos', async () => {
        const usuario = await bd.criarUsuario({ email: 'Pessoa.Teste@Escola.EDU', senha: SENHA });
        const agente = criarAgente(app);

        const resposta = await tentarLogin(agente, `  ${usuario.email.toUpperCase()}  `, SENHA);

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe('/admin');
    });

    test('recusa senha invalida sem criar sessao', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA });
        const agente = criarAgente(app);

        const resposta = await tentarLogin(agente, usuario.email, 'SenhaErrada@999');

        expect(resposta.status).toBe(401);
        expect(resposta.text).toContain('E-mail ou senha inválidos.');
        // O e-mail volta preenchido, a senha nunca.
        expect(resposta.text).toContain(usuario.email);
        expect(resposta.text).not.toContain('SenhaErrada@999');

        const painel = await agente.get('/admin');
        expect(painel.status).toBe(302);
        expect(painel.headers.location).toContain('/login');
    });

    test('recusa e-mail inexistente com a mesma mensagem generica da senha invalida', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA });
        const agente = criarAgente(app);

        const inexistente = await tentarLogin(agente, 'ninguem@teste.local', SENHA);
        const senhaErrada = await tentarLogin(criarAgente(app), usuario.email, 'outra-senha');

        expect(inexistente.status).toBe(401);
        expect(inexistente.text).toContain('E-mail ou senha inválidos.');
        // Nao revela se a conta existe: mesma mensagem nos dois casos.
        expect(inexistente.text).toContain('E-mail ou senha inválidos.');
        expect(senhaErrada.text).toContain('E-mail ou senha inválidos.');
    });

    test('usuario inativo nao entra', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, ativo: false });
        const agente = criarAgente(app);

        const resposta = await tentarLogin(agente, usuario.email, SENHA);

        expect(resposta.status).toBe(401);
        expect(resposta.text).toContain('E-mail ou senha inválidos.');

        const painel = await agente.get('/admin');
        expect(painel.status).toBe(302);
        expect(painel.headers.location).toContain('/login');
    });

    test('sessao inativada durante o uso deixa de valer', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, perfil: 'admin' });
        const agente = criarAgente(app);
        await login(agente, usuario.email, SENHA);

        await bd.query('UPDATE usuarios SET ativo = FALSE WHERE id = $1', [usuario.id]);

        const painel = await agente.get('/admin');
        expect(painel.status).toBe(302);
        expect(painel.headers.location).toContain('/login');
    });

    test('exige e-mail e senha preenchidos', async () => {
        const agente = criarAgente(app);
        const resposta = await tentarLogin(agente, '', '');

        expect(resposta.status).toBe(422);
        expect(resposta.text).toContain('Informe e-mail e senha válidos.');
    });

    test('regenera a sessao apos autenticar (protecao contra session fixation)', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, perfil: 'admin' });
        const agente = criarAgente(app);

        const telaLogin = await agente.get('/login');
        const sidAnterior = sidDaResposta(telaLogin);
        expect(sidAnterior).toBeTruthy();

        const token = /<input[^>]*name="_csrf"[^>]*value="([^"]+)"/.exec(telaLogin.text)[1];
        const resposta = await agente
            .post('/login')
            .type('form')
            .send({ email: usuario.email, senha: SENHA, _csrf: token });

        const sidNovo = sidDaResposta(resposta);

        expect(resposta.status).toBe(302);
        expect(sidNovo).toBeTruthy();
        expect(sidNovo).not.toBe(sidAnterior);

        // A sessao anterior foi descartada do store.
        const antiga = await bd.query('SELECT sid FROM session WHERE sid = $1', [sidAnterior]);
        expect(antiga.rowCount).toBe(0);
    });
});

describe('senhas', () => {
    test('a senha e gravada apenas como hash bcrypt', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA });

        const resultado = await bd.query('SELECT * FROM usuarios WHERE id = $1', [usuario.id]);
        const linha = resultado.rows[0];

        expect(linha.senha_hash).toMatch(/^\$2[aby]\$/);
        expect(linha.senha_hash).not.toContain(SENHA);

        // Nenhuma coluna da tabela guarda a senha em texto puro.
        Object.values(linha).forEach((valor) => {
            expect(String(valor)).not.toBe(SENHA);
        });

        await expect(autenticacaoService.verificarSenha(SENHA, linha.senha_hash)).resolves.toBe(
            true
        );
    });

    test('nenhuma senha em texto puro existe no banco de teste', async () => {
        await bd.criarUsuario({ senha: SENHA });

        const resultado = await bd.query(
            `SELECT COUNT(*)::int AS total
               FROM usuarios
              WHERE senha_hash IS NULL OR senha_hash NOT LIKE '$2%'`
        );

        expect(resultado.rows[0].total).toBe(0);
    });

    test('a tabela usuarios nao possui mais colunas de acesso legado', async () => {
        const resultado = await bd.query(
            `SELECT column_name
               FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'usuarios'`,
            [config.banco.schema]
        );

        const colunas = resultado.rows.map((linha) => linha.column_name);

        expect(colunas).toContain('senha_hash');
        expect(colunas).not.toContain('senha');
        expect(colunas).not.toContain('token_acesso');
        expect(colunas).not.toContain('curso_responsavel_id');
        expect(colunas).not.toContain('unidade_responsavel');
    });
});

describe('logout', () => {
    test('encerra a sessao e limpa o cookie', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, perfil: 'admin' });
        const agente = criarAgente(app);
        await login(agente, usuario.email, SENHA);

        const saida = await postComCsrf(agente, '/logout');

        expect(saida.status).toBe(302);
        expect(saida.headers.location).toBe('/login');

        // Sem sessao: a tela de login volta a ser exibida e o painel bloqueia.
        const telaLogin = await agente.get('/login');
        expect(telaLogin.status).toBe(200);
        expect(telaLogin.text).toContain('name="_csrf"');

        const painel = await agente.get('/admin');
        expect(painel.status).toBe(302);
        expect(painel.headers.location).toContain('/login');
    });
});

describe('protecao CSRF', () => {
    test('rejeita POST /login sem token', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA });
        const agente = criarAgente(app);

        const resposta = await agente
            .post('/login')
            .type('form')
            .set('Accept', 'application/json')
            .send({ email: usuario.email, senha: SENHA });

        expect(resposta.status).toBe(403);
        expect(resposta.body.erro).toContain('Sessão expirada ou requisição inválida.');
    });

    test('rejeita POST /login com token invalido', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA });
        const agente = criarAgente(app);
        await tokenCsrf(agente); // cria a sessao com um token valido

        const resposta = await agente
            .post('/login')
            .type('form')
            .set('Accept', 'application/json')
            .send({ email: usuario.email, senha: SENHA, _csrf: 'token-falso' });

        expect(resposta.status).toBe(403);
    });

    test('rejeita POST /logout sem token', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, perfil: 'admin' });
        const agente = criarAgente(app);
        await login(agente, usuario.email, SENHA);

        const resposta = await agente.post('/logout').set('Accept', 'application/json').send({});

        expect(resposta.status).toBe(403);

        // A sessao continua valida: o logout nao aconteceu.
        const telaLogin = await agente.get('/login');
        expect(telaLogin.status).toBe(302);
    });

    test('aceita o token enviado pelo cabecalho x-csrf-token', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, perfil: 'admin' });
        const agente = criarAgente(app);
        const token = await tokenCsrf(agente);

        const resposta = await agente
            .post('/login')
            .type('form')
            .set('x-csrf-token', token)
            .send({ email: usuario.email, senha: SENHA });

        expect(resposta.status).toBe(302);
    });
});

describe('rotas protegidas', () => {
    test('/admin sem sessao redireciona para /login preservando o destino', async () => {
        const agente = criarAgente(app);
        const resposta = await agente.get('/admin');

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toContain('/login');
    });

    test('/admin guarda o caminho original em ?proximo', async () => {
        const agente = criarAgente(app);
        const resposta = await agente.get('/admin/turmas?pagina=2');

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe(
            `/login?proximo=${encodeURIComponent('/admin/turmas?pagina=2')}`
        );
    });

    test('nao existe mais autenticacao por token na URL', async () => {
        const usuario = await bd.criarUsuario({ senha: SENHA, perfil: 'admin' });
        const agente = criarAgente(app);

        for (const token of ['qualquer-coisa', 'abc123', usuario.email]) {
            const resposta = await agente.get(`/admin?token=${encodeURIComponent(token)}`);
            expect(resposta.status).toBe(302);
            expect(resposta.headers.location).toContain('/login');
        }
    });

    test('requisicoes JSON sem sessao recebem 401 em vez de redirecionamento', async () => {
        const agente = criarAgente(app);
        const resposta = await agente.get('/admin').set('Accept', 'application/json');

        expect(resposta.status).toBe(401);
    });
});

describe('protecao contra open redirect', () => {
    const criarAdmin = () => bd.criarUsuario({ senha: SENHA, perfil: 'admin' });

    test.each([
        ['https://evil.com', '/admin'],
        ['//evil.com', '/admin'],
        ['http://evil.com/x', '/admin'],
        ['/\\evil.com', '/admin'],
        ['evil.com', '/admin'],
    ])('proximo=%s nao redireciona para fora', async (proximo, esperado) => {
        const usuario = await criarAdmin();
        const agente = criarAgente(app);

        const resposta = await tentarLogin(agente, usuario.email, SENHA, { proximo });

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe(esperado);
    });

    test('destino interno valido e respeitado', async () => {
        const usuario = await criarAdmin();
        const agente = criarAgente(app);

        const resposta = await tentarLogin(agente, usuario.email, SENHA, {
            proximo: '/admin/turmas?pagina=2',
        });

        expect(resposta.status).toBe(302);
        expect(resposta.headers.location).toBe('/admin/turmas?pagina=2');
    });

    test('o formulario de login preserva o destino interno recebido', async () => {
        const agente = criarAgente(app);

        const interno = await agente.get(`/login?proximo=${encodeURIComponent('/admin/aulas')}`);
        expect(interno.text).toContain('name="proximo" value="/admin/aulas"');

        const externo = await agente.get('/login?proximo=https://evil.com');
        expect(externo.text).not.toContain('evil.com');
    });
});

describe('matriz de permissoes', () => {
    const { PERMISSOES, temPermissao, RECURSOS, ACOES } = autorizacao;

    test('admin pode tudo em todos os recursos', () => {
        RECURSOS.forEach((recurso) => {
            ACOES.forEach((acao) => {
                expect(temPermissao({ perfil: 'admin' }, recurso, acao)).toBe(true);
            });
        });
    });

    test('somente admin acessa usuarios', () => {
        ACOES.forEach((acao) => {
            expect(temPermissao({ perfil: 'coordenador' }, 'usuarios', acao)).toBe(false);
            expect(temPermissao({ perfil: 'nap' }, 'usuarios', acao)).toBe(false);
        });
        expect(PERMISSOES.coordenador.usuarios).toEqual([]);
        expect(PERMISSOES.nap.usuarios).toEqual([]);
    });

    test('coordenador le os cadastros estruturais mas so edita turmas e aulas', () => {
        const coordenador = { perfil: 'coordenador' };

        [
            'cursos',
            'disciplinas',
            'professores',
            'locais',
            'campus',
            'turnos',
            'horarios',
            'periodos',
        ].forEach((recurso) => {
            expect(temPermissao(coordenador, recurso, 'ler')).toBe(true);
            expect(temPermissao(coordenador, recurso, 'criar')).toBe(false);
            expect(temPermissao(coordenador, recurso, 'editar')).toBe(false);
            expect(temPermissao(coordenador, recurso, 'inativar')).toBe(false);
        });

        ['turmas', 'aulas'].forEach((recurso) => {
            ACOES.forEach((acao) => {
                expect(temPermissao(coordenador, recurso, acao)).toBe(true);
            });
        });
    });

    test('nap edita aulas e mantem locais, sem criar turmas', () => {
        const nap = { perfil: 'nap' };

        expect(temPermissao(nap, 'aulas', 'ler')).toBe(true);
        expect(temPermissao(nap, 'aulas', 'editar')).toBe(true);
        expect(temPermissao(nap, 'aulas', 'criar')).toBe(false);
        expect(temPermissao(nap, 'aulas', 'inativar')).toBe(false);

        ACOES.forEach((acao) => {
            expect(temPermissao(nap, 'locais', acao)).toBe(true);
        });

        expect(temPermissao(nap, 'turmas', 'ler')).toBe(true);
        expect(temPermissao(nap, 'turmas', 'criar')).toBe(false);
        expect(temPermissao(nap, 'turmas', 'editar')).toBe(false);
    });

    test('perfil ausente ou desconhecido nao tem permissao alguma', () => {
        expect(temPermissao(null, 'turmas', 'ler')).toBe(false);
        expect(temPermissao({}, 'turmas', 'ler')).toBe(false);
        expect(temPermissao({ perfil: 'invasor' }, 'turmas', 'ler')).toBe(false);
    });
});

describe('middlewares de autorizacao', () => {
    /** Constroi req/res/next minimos para exercitar os middlewares. */
    const contexto = (usuario) => {
        const capturado = {};
        return {
            req: { usuario },
            res: { locals: {} },
            next: (erro) => {
                capturado.erro = erro;
            },
            capturado,
        };
    };

    test('exigirPerfil libera o perfil correto e bloqueia os demais', () => {
        const permitido = contexto({ perfil: 'admin' });
        autorizacao.exigirPerfil('admin')(permitido.req, permitido.res, permitido.next);
        expect(permitido.capturado.erro).toBeUndefined();

        const negado = contexto({ perfil: 'nap' });
        autorizacao.exigirPerfil('admin', 'coordenador')(negado.req, negado.res, negado.next);
        expect(negado.capturado.erro).toBeDefined();
        expect(negado.capturado.erro.status).toBe(403);
    });

    test('exigirPerfil sem usuario responde 401', () => {
        const anonimo = contexto(null);
        autorizacao.exigirPerfil('admin')(anonimo.req, anonimo.res, anonimo.next);
        expect(anonimo.capturado.erro.status).toBe(401);
    });

    test('exigirPermissao usa a matriz de permissoes', () => {
        const leitura = contexto({ perfil: 'nap' });
        autorizacao.exigirPermissao('aulas', 'editar')(leitura.req, leitura.res, leitura.next);
        expect(leitura.capturado.erro).toBeUndefined();

        const escrita = contexto({ perfil: 'nap' });
        autorizacao.exigirPermissao('turmas', 'criar')(escrita.req, escrita.res, escrita.next);
        expect(escrita.capturado.erro).toBeDefined();
        expect(escrita.capturado.erro.status).toBe(403);
    });
});

describe('escopo de curso e campus', () => {
    test('coordenador so acessa turmas dos cursos vinculados', async () => {
        const campus = await bd.criarCampus();
        const cursoDele = await bd.criarCurso({ campusIds: [campus.id] });
        const cursoAlheio = await bd.criarCurso({ campusIds: [campus.id] });

        const turmaDele = await bd.criarTurma({ cursoId: cursoDele.id, campusId: campus.id });
        const turmaAlheia = await bd.criarTurma({ cursoId: cursoAlheio.id, campusId: campus.id });

        const usuario = {
            perfil: 'coordenador',
            cursosIds: [cursoDele.id],
            campusIds: [],
        };

        expect(autorizacao.podeAcessarCurso(usuario, cursoDele.id)).toBe(true);
        expect(autorizacao.podeAcessarCurso(usuario, cursoAlheio.id)).toBe(false);
        await expect(autorizacao.podeAcessarTurma(usuario, turmaDele.id)).resolves.toBe(true);
        await expect(autorizacao.podeAcessarTurma(usuario, turmaAlheia.id)).resolves.toBe(false);

        await expect(
            autorizacao.garantirAcessoTurma(usuario, turmaDele.id)
        ).resolves.toBeUndefined();
        await expect(autorizacao.garantirAcessoTurma(usuario, turmaAlheia.id)).rejects.toThrow(
            /permissão/i
        );
    });

    test('nap so acessa turmas dos campus vinculados', async () => {
        const campusDele = await bd.criarCampus();
        const campusAlheio = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campusDele.id, campusAlheio.id] });

        const turmaDele = await bd.criarTurma({ cursoId: curso.id, campusId: campusDele.id });
        const turmaAlheia = await bd.criarTurma({ cursoId: curso.id, campusId: campusAlheio.id });

        const usuario = { perfil: 'nap', cursosIds: [], campusIds: [campusDele.id] };

        expect(autorizacao.podeAcessarCampus(usuario, campusDele.id)).toBe(true);
        expect(autorizacao.podeAcessarCampus(usuario, campusAlheio.id)).toBe(false);
        await expect(autorizacao.podeAcessarTurma(usuario, turmaDele.id)).resolves.toBe(true);
        await expect(autorizacao.podeAcessarTurma(usuario, turmaAlheia.id)).resolves.toBe(false);
    });

    test('turma inexistente e tratada como nao encontrada', async () => {
        const admin = { perfil: 'admin', cursosIds: [], campusIds: [] };
        await expect(autorizacao.podeAcessarTurma(admin, 999999)).resolves.toBe(false);
        await expect(autorizacao.garantirAcessoTurma(admin, 999999)).rejects.toThrow(
            /não encontrada/i
        );
    });

    test('filtroTurmas nao restringe o admin', () => {
        const filtro = escopoService.filtroTurmas({ perfil: 'admin' }, 't', 1);
        expect(filtro.sql).toBe('');
        expect(filtro.parametros).toEqual([]);
        expect(filtro.proximoIndice).toBe(1);
        expect(escopoService.escopoGlobal({ perfil: 'admin' })).toBe(true);
    });

    test('filtroTurmas numera os placeholders a partir do indice informado', () => {
        const filtro = escopoService.filtroTurmas(
            { perfil: 'coordenador', cursosIds: [1, 2] },
            'tur',
            3
        );

        expect(filtro.sql).toBe('tur.curso_id = ANY($3::int[])');
        expect(filtro.parametros).toEqual([[1, 2]]);
        expect(filtro.proximoIndice).toBe(4);
    });

    test('filtroTurmas aplicado em consulta real respeita o escopo', async () => {
        const campus = await bd.criarCampus();
        const cursoA = await bd.criarCurso({ campusIds: [campus.id] });
        const cursoB = await bd.criarCurso({ campusIds: [campus.id] });
        await bd.criarTurma({ cursoId: cursoA.id, campusId: campus.id });
        await bd.criarTurma({ cursoId: cursoB.id, campusId: campus.id });

        const consultar = async (usuario) => {
            const filtro = escopoService.filtroTurmas(usuario, 't', 1);
            const sql = `SELECT t.id FROM turmas t WHERE t.ativo${filtro.sql ? ` AND ${filtro.sql}` : ''}`;
            const resultado = await bd.query(sql, filtro.parametros);
            return resultado.rowCount;
        };

        expect(await consultar({ perfil: 'admin' })).toBe(2);
        expect(await consultar({ perfil: 'coordenador', cursosIds: [cursoA.id] })).toBe(1);
        // Escopo vazio devolve lista vazia, nunca erro.
        expect(await consultar({ perfil: 'coordenador', cursosIds: [] })).toBe(0);
        expect(await consultar({ perfil: 'nap', campusIds: [] })).toBe(0);
        expect(await consultar({ perfil: 'nap', campusIds: [campus.id] })).toBe(2);
    });

    test('carregarEscopo devolve os vinculos gravados', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const usuario = await bd.criarUsuario({
            perfil: 'coordenador',
            cursosIds: [curso.id],
            campusIds: [campus.id],
        });

        await expect(escopoService.carregarEscopo(usuario.id)).resolves.toEqual({
            cursosIds: [curso.id],
            campusIds: [campus.id],
        });
    });
});

describe('usuario da sessao', () => {
    test('req.usuario carrega perfil e escopo do banco', async () => {
        const campus = await bd.criarCampus();
        const curso = await bd.criarCurso({ campusIds: [campus.id] });
        const usuario = await bd.criarUsuario({
            senha: SENHA,
            perfil: 'coordenador',
            cursosIds: [curso.id],
            campusIds: [campus.id],
        });

        const carregado = await require('../src/repositories/usuarioRepository').buscarPorId(
            usuario.id
        );

        expect(carregado).toMatchObject({
            id: usuario.id,
            email: usuario.email,
            perfil: 'coordenador',
            ativo: true,
            cursosIds: [curso.id],
            campusIds: [campus.id],
        });
        expect(carregado.senha_hash).toBeUndefined();
    });
});
