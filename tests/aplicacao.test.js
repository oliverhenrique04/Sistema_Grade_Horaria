/**
 * Testes de fumaca da aplicacao: seguranca HTTP, BASE_PATH, paginas de erro e
 * garantias estruturais do codigo (nada de stub ou pendencia esquecida).
 */
const fs = require('node:fs');
const path = require('node:path');
const { criarApp, criarAgente } = require('./helpers/app');

const RAIZ = path.resolve(__dirname, '..');

/** Lista recursivamente os arquivos de codigo do projeto (sem node_modules). */
const listarArquivos = (diretorio, extensoes, acumulado = []) => {
    for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
        if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;

        const caminho = path.join(diretorio, entrada.name);

        if (entrada.isDirectory()) {
            listarArquivos(caminho, extensoes, acumulado);
        } else if (extensoes.some((extensao) => entrada.name.endsWith(extensao))) {
            acumulado.push(caminho);
        }
    }

    return acumulado;
};

/** Remove comentarios para que mencoes explicativas nao gerem falso positivo. */
const semComentarios = (conteudo) =>
    conteudo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\*.*$/gm, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/<%#[\s\S]*?%>/g, '');

describe('Aplicacao', () => {
    let app;
    let agente;

    beforeAll(() => {
        app = criarApp();
        agente = criarAgente(app);
    });

    describe('seguranca HTTP', () => {
        it('envia os cabecalhos do Helmet', async () => {
            const resposta = await agente.get('/');

            expect(resposta.headers['x-content-type-options']).toBe('nosniff');
            expect(resposta.headers['content-security-policy']).toBeDefined();
            expect(resposta.headers['x-powered-by']).toBeUndefined();
        });

        it('recusa corpo de requisicao acima do limite configurado', async () => {
            const enorme = 'a'.repeat(500 * 1024);
            const resposta = await agente.post('/login').type('form').send({ email: enorme });

            expect(resposta.status).toBe(413);
        });
    });

    describe('autenticacao por token na URL', () => {
        it('nao existe mais: /admin?token=... nao autentica', async () => {
            const resposta = await agente.get('/admin?token=master123');

            expect(resposta.status).toBe(302);
            expect(resposta.headers.location).toMatch(/\/login/);
        });

        it('nenhum arquivo do projeto le token de acesso pela query string', () => {
            const arquivos = [
                ...listarArquivos(path.join(RAIZ, 'src'), ['.js', '.ejs']),
                path.join(RAIZ, 'app.js'),
            ];

            const suspeitos = arquivos.filter((arquivo) => {
                const codigo = semComentarios(fs.readFileSync(arquivo, 'utf8'));
                return /req\.query\.token|token_acesso|\?token=/.test(codigo);
            });

            expect(suspeitos).toEqual([]);
        });
    });

    describe('BASE_PATH e proxy reverso', () => {
        it('usa o prefixo informado pelo proxy nos links gerados', async () => {
            const resposta = await agente.get('/login').set('X-Forwarded-Prefix', '/grades');

            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain('action="/grades/login"');
        });

        it('sem prefixo, os links ficam na raiz', async () => {
            const resposta = await agente.get('/login');

            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain('action="/login"');
        });
    });

    describe('paginas de erro', () => {
        it('responde 404 com pagina propria', async () => {
            const resposta = await agente.get('/rota-que-nao-existe');

            expect(resposta.status).toBe(404);
            expect(resposta.text).toContain('404');
            expect(resposta.headers['content-type']).toMatch(/html/);
        });

        it('responde JSON quando o cliente pede JSON', async () => {
            const resposta = await agente
                .get('/rota-que-nao-existe')
                .set('Accept', 'application/json');

            expect(resposta.status).toBe(404);
            expect(resposta.body.erro).toBeDefined();
        });

        it('usa a pagina propria tambem quando o erro nasce antes das rotas', async () => {
            // Falha do parser de corpo: e levantada antes de qualquer rota, quando
            // `res.locals` tem apenas o que o contextoBase colocou. As paginas de
            // erro chamam `asset` e `withBase`; se esses helpers ainda nao existirem
            // o render quebra e o Express devolve o "Bad Request" cru do
            // finalhandler, sem explicacao nenhuma para o operador.
            const resposta = await agente
                .post('/login')
                .set('Content-Type', 'application/json')
                .send('{invalido');

            expect(resposta.status).toBe(400);
            expect(resposta.headers['content-type']).toMatch(/html/);
            expect(resposta.text).not.toContain('<pre>Bad Request</pre>');
            expect(resposta.text).toContain('Ocorreu um erro inesperado');
        });
    });

    describe('garantias estruturais', () => {
        it('nao restam stubs pendentes no codigo', () => {
            const arquivos = listarArquivos(path.join(RAIZ, 'src'), ['.js', '.ejs']);

            const comStub = arquivos.filter((arquivo) =>
                fs.readFileSync(arquivo, 'utf8').includes('STUB-PENDENTE')
            );

            expect(comStub).toEqual([]);
        });

        it('nao restam TODO/FIXME no codigo de producao', () => {
            const arquivos = listarArquivos(path.join(RAIZ, 'src'), ['.js', '.ejs']);

            const comPendencia = arquivos.filter((arquivo) =>
                /\b(TODO|FIXME|XXX)\b/.test(fs.readFileSync(arquivo, 'utf8'))
            );

            expect(comPendencia).toEqual([]);
        });

        it('todo formulario POST das views inclui o campo _csrf', () => {
            const views = listarArquivos(path.join(RAIZ, 'src', 'views'), ['.ejs']);

            const semCsrf = views.filter((arquivo) => {
                const conteudo = fs.readFileSync(arquivo, 'utf8');
                const formulariosPost =
                    conteudo.match(/<form[^>]*method=["']post["'][^>]*>/gi) || [];
                if (formulariosPost.length === 0) return false;

                // Conta os campos _csrf presentes no arquivo e compara com os formularios.
                const camposCsrf = (conteudo.match(/name=["']_csrf["']/gi) || []).length;
                return camposCsrf < formulariosPost.length;
            });

            expect(semCsrf).toEqual([]);
        });

        it('nenhum SQL fora dos repositories, migrations e seeds', () => {
            const arquivos = listarArquivos(path.join(RAIZ, 'src'), ['.js']).filter(
                (arquivo) =>
                    !arquivo.includes(path.join('src', 'repositories')) &&
                    !arquivo.includes(path.join('src', 'database'))
            );

            const comSql = arquivos.filter((arquivo) => {
                const conteudo = fs.readFileSync(arquivo, 'utf8');
                return /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i.test(conteudo);
            });

            expect(comSql).toEqual([]);
        });
    });
});
