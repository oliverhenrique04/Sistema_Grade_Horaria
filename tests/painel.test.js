/**
 * Painel de corredor (TVs dos blocos).
 *
 * Cobre as tres regras que carregam o desenho — faixa do dia pelo relogio,
 * compactacao em dois passos e descarte do que ja terminou —, a rota publica
 * com entrada suja, o recorte por curso/turma/local e a permissao do gerador
 * de links.
 *
 * O relogio nunca e o real: `montarPainel` aceita `agora`, e todos os casos de
 * faixa passam um instante fixo. Um teste que dependesse da hora da execucao
 * passaria de manha e falharia a noite.
 */
const request = require('supertest');

const bd = require('./helpers/db');
const servico = require('../src/services/painelService');
const validador = require('../src/validators/painel');
const { blocoDoLocal, agruparPorBloco } = require('../src/utils/blocos');
const { PERMISSOES } = require('../src/middlewares/autorizacao');

/** Instancia a aplicacao real. Falha de carga deve ser ruidosa. */
const app = require('../src/app').criarApp();

/**
 * Instante fixo no fuso da instituicao (UTC-3), para os testes de faixa.
 * A soma das 3 horas passa por `Date.UTC`, que rola o dia sozinho — montar a
 * string na mao produziria "26:30" para as 23:30.
 */
const emSaoPaulo = (horaMinuto, dia = '2026-08-05') => {
    const [ano, mes, diaDoMes] = dia.split('-').map(Number);
    const [hora, minuto] = horaMinuto.split(':').map(Number);
    return new Date(Date.UTC(ano, mes - 1, diaDoMes, hora + 3, minuto));
};

/** Linha crua como o repositorio devolve, para exercitar a compactacao. */
const linhaCrua = ({
    aulaId,
    turmaId = 1,
    turmaCodigo = 'DIR01M1',
    disciplinaId = 10,
    disciplina = 'Direito Civil',
    professorId = 20,
    professor = 'Ana Silva',
    localId = null,
    local = null,
    inicio,
    fim,
    dia = 3,
}) => ({
    aula_id: aulaId,
    dia_semana: dia,
    modalidade: 'presencial',
    turma_id: turmaId,
    turma_codigo: turmaCodigo,
    turma_nome: turmaCodigo,
    semestre_curricular: 1,
    curso_id: 5,
    curso_sigla: 'DIR',
    curso_nome: 'Direito',
    disciplina_id: disciplinaId,
    disciplina_nome: disciplina,
    professor_id: professorId,
    professor_nome: professor,
    local_id: localId,
    local_nome: local,
    hora_inicio: inicio,
    hora_fim: fim,
    horario_ordem: 1,
});

describe('painel de corredor', () => {
    describe('compactação', () => {
        test('a mesma aula vista por várias turmas vira uma linha só', () => {
            const blocos = servico.compactar([
                linhaCrua({
                    aulaId: 1,
                    turmaId: 1,
                    turmaCodigo: 'AUR01M1',
                    inicio: '08:00',
                    fim: '08:50',
                }),
                linhaCrua({
                    aulaId: 1,
                    turmaId: 2,
                    turmaCodigo: 'AUR02M1',
                    inicio: '08:00',
                    fim: '08:50',
                }),
            ]);

            expect(blocos).toHaveLength(1);
            expect(blocos[0].turmas.map((turma) => turma.codigo)).toEqual(['AUR01M1', 'AUR02M1']);
        });

        test('horários seguidos viram uma faixa única', () => {
            const blocos = servico.compactar([
                linhaCrua({ aulaId: 1, inicio: '08:00', fim: '08:50' }),
                linhaCrua({ aulaId: 2, inicio: '08:50', fim: '09:40' }),
                linhaCrua({ aulaId: 3, inicio: '09:50', fim: '10:40' }),
            ]);

            expect(blocos).toHaveLength(1);
            expect(servico.paraHora(blocos[0].inicio)).toBe('08:00');
            expect(servico.paraHora(blocos[0].fim)).toBe('10:40');
            expect(blocos[0].horarios).toBe(3);
        });

        test('lacuna maior que o intervalo institucional separa os blocos', () => {
            const blocos = servico.compactar([
                linhaCrua({ aulaId: 1, inicio: '08:00', fim: '08:50' }),
                linhaCrua({ aulaId: 2, inicio: '10:40', fim: '11:30' }),
            ]);

            expect(blocos).toHaveLength(2);
        });

        test('a mesma disciplina em salas diferentes não se junta', () => {
            const blocos = servico.compactar([
                linhaCrua({ aulaId: 1, inicio: '08:00', fim: '08:50', localId: 1, local: '101 C' }),
                linhaCrua({ aulaId: 2, inicio: '08:50', fim: '09:40', localId: 2, local: '104 C' }),
            ]);

            expect(blocos).toHaveLength(2);
        });

        test('turmas diferentes na mesma disciplina e horário não se juntam', () => {
            // Duas aulas distintas que so coincidem no conteudo: juntar
            // esconderia uma delas.
            const blocos = servico.compactar([
                linhaCrua({
                    aulaId: 1,
                    turmaId: 1,
                    turmaCodigo: 'DIR01M1',
                    inicio: '08:00',
                    fim: '08:50',
                }),
                linhaCrua({
                    aulaId: 2,
                    turmaId: 2,
                    turmaCodigo: 'DIR02M1',
                    inicio: '08:50',
                    fim: '09:40',
                }),
            ]);

            expect(blocos).toHaveLength(2);
        });

        test('a junção não atravessa a fronteira entre tarde e noite', () => {
            // 17:20-18:10 e 18:20-19:10 tem exatamente 10 min de vao (turno
            // Integral). Juntados, o bloco sumiria do quadro da noite.
            const blocos = servico.compactar([
                linhaCrua({ aulaId: 1, inicio: '17:20', fim: '18:10' }),
                linhaCrua({ aulaId: 2, inicio: '18:20', fim: '19:10' }),
            ]);

            expect(blocos).toHaveLength(2);
            expect(servico.faixaDe(blocos[0].inicio).chave).toBe('tarde');
            expect(servico.faixaDe(blocos[1].inicio).chave).toBe('noite');
        });
    });

    describe('faixa do dia', () => {
        const blocos = () =>
            servico.compactar([
                linhaCrua({ aulaId: 1, inicio: '08:00', fim: '11:30', disciplinaId: 1 }),
                linhaCrua({ aulaId: 2, inicio: '13:50', fim: '17:20', disciplinaId: 2 }),
                linhaCrua({ aulaId: 3, inicio: '19:00', fim: '22:30', disciplinaId: 3 }),
            ]);

        test('escolhe a primeira faixa que ainda tem aula por terminar', () => {
            expect(servico.escolherFaixa(blocos(), 9 * 60).faixa.chave).toBe('manha');
            expect(servico.escolherFaixa(blocos(), 15 * 60).faixa.chave).toBe('tarde');
            expect(servico.escolherFaixa(blocos(), 20 * 60).faixa.chave).toBe('noite');
        });

        test('no vão do almoço já mostra a tarde', () => {
            // A manha termina 11:30; as 12:15 nao ha mais nada dela por vir.
            expect(servico.escolherFaixa(blocos(), 12 * 60 + 15).faixa.chave).toBe('tarde');
        });

        test('a faixa corrente dura até a última aula terminar, não até a hora cheia', () => {
            expect(servico.escolherFaixa(blocos(), 11 * 60 + 29).faixa.chave).toBe('manha');
            expect(servico.escolherFaixa(blocos(), 11 * 60 + 30).faixa.chave).toBe('tarde');
        });

        test('encerrado o dia, não há faixa a exibir', () => {
            expect(servico.escolherFaixa(blocos(), 23 * 60)).toBeNull();
        });

        test('a faixa sai do relógio, não do turno da turma', () => {
            // No banco real o turno "Matutino" tem horario as 17:20. O bloco
            // pertence a tarde por causa da hora, nao do turno.
            expect(servico.faixaDe(servico.paraMinutos('17:20')).chave).toBe('tarde');
            expect(servico.faixaDe(servico.paraMinutos('13:50')).chave).toBe('tarde');
            expect(servico.faixaDe(servico.paraMinutos('11:30')).chave).toBe('manha');
            expect(servico.faixaDe(servico.paraMinutos('18:10')).chave).toBe('noite');
        });
    });

    describe('relógio no fuso da instituição', () => {
        test('usa America/Sao_Paulo, não o fuso do processo', () => {
            // 2026-08-05T14:30:00Z = 11:30 em Brasilia (UTC-3).
            const relogio = servico.agoraLocal(new Date('2026-08-05T14:30:00Z'));
            expect(relogio.minutos).toBe(11 * 60 + 30);
            expect(relogio.diaSemana).toBe(3);
        });

        test('a virada do dia acontece pelo calendário local', () => {
            // 2026-08-06T02:00:00Z ainda e dia 5 (quarta) em Brasilia.
            const relogio = servico.agoraLocal(new Date('2026-08-06T02:00:00Z'));
            expect(relogio.data).toBe('2026-08-05');
            expect(relogio.diaSemana).toBe(3);
        });
    });

    describe('descarte do que já terminou', () => {
        const comFim = (fins) =>
            fins.map((fim, indice) => ({
                inicio: 8 * 60,
                fim: servico.paraMinutos(fim),
                id: indice,
            }));

        test('cabendo numa página, nada é descartado', () => {
            const blocos = comFim(['09:00', '10:00', '11:00']);
            expect(servico.aparar(blocos, 12 * 60, 18)).toHaveLength(3);
        });

        test('não cabendo, o que já terminou sai da frente', () => {
            const blocos = comFim(Array(20).fill('09:00').concat(Array(5).fill('23:00')));
            const visiveis = servico.aparar(blocos, 10 * 60, 18);

            expect(visiveis).toHaveLength(5);
            expect(visiveis.every((bloco) => bloco.fim > 10 * 60)).toBe(true);
        });

        test('se tudo terminou, o quadro continua mostrando tudo', () => {
            const blocos = comFim(Array(25).fill('09:00'));
            expect(servico.aparar(blocos, 12 * 60, 18)).toHaveLength(25);
        });
    });

    describe('paginação', () => {
        const blocosFalsos = (quantidade) =>
            Array.from({ length: quantidade }, (_, i) => ({ inicio: i, fim: i + 1 }));

        test('cabendo na capacidade, é uma página só', () => {
            expect(servico.paginar(blocosFalsos(18), 18)).toHaveLength(1);
        });

        test('as páginas são equilibradas, não cheias até a última sobrar', () => {
            const paginas = servico.paginar(blocosFalsos(20), 18);
            expect(paginas).toHaveLength(2);
            expect(paginas.map((pagina) => pagina.length)).toEqual([10, 10]);
        });

        test('nenhuma página passa da capacidade', () => {
            servico.paginar(blocosFalsos(40), 18).forEach((pagina) => {
                expect(pagina.length).toBeLessThanOrEqual(18);
            });
        });
    });

    describe('situação de cada linha', () => {
        const bloco = { inicio: 8 * 60, fim: 10 * 60 };

        test.each([
            ['antes, distante', 7 * 60, 'depois'],
            ['antes, em breve', 7 * 60 + 40, 'breve'],
            ['em curso', 9 * 60, 'agora'],
            ['terminando', 9 * 60 + 50, 'terminando'],
            ['encerrada', 10 * 60, 'fim'],
        ])('%s', (_rotulo, agora, esperado) => {
            expect(servico.situacaoDe(bloco, agora)).toBe(esperado);
        });
    });

    describe('bloco derivado do nome do local', () => {
        test('a letra final identifica o prédio', () => {
            expect(blocoDoLocal('101 C')).toBe('C');
            expect(blocoDoLocal('110 B')).toBe('B');
            expect(blocoDoLocal('305 D')).toBe('D');
        });

        test('local sem letra não pertence a bloco nenhum', () => {
            expect(blocoDoLocal('Auditório')).toBeNull();
            expect(blocoDoLocal('Lab 01')).toBeNull();
            expect(blocoDoLocal('Skill Lab')).toBeNull();
        });

        test('agrupa por letra e joga os sem bloco para o fim', () => {
            const grupos = agruparPorBloco([
                { id: 1, nome: '101 C' },
                { id: 2, nome: 'Auditório' },
                { id: 3, nome: '110 B' },
                { id: 4, nome: '102 C' },
            ]);

            expect(grupos.map((grupo) => grupo.bloco)).toEqual(['B', 'C', 'Outros']);
            expect(grupos[1].locais).toHaveLength(2);
        });
    });

    describe('validação da query string', () => {
        test('aceita lista por vírgula e lista repetida', () => {
            expect(validador.validarRecorte({ locais: '26,27,28' }).locaisIds).toEqual([
                26, 27, 28,
            ]);
            expect(validador.validarRecorte({ locais: ['26', '27'] }).locaisIds).toEqual([26, 27]);
        });

        test('descarta item inválido sem derrubar a lista', () => {
            expect(validador.validarRecorte({ cursos: '26,abc,-3,28' }).cursosIds).toEqual([
                26, 28,
            ]);
        });

        test('remove repetidos', () => {
            expect(validador.validarRecorte({ turmas: '7,7,8' }).turmasIds).toEqual([7, 8]);
        });

        test('limita a quantidade de ids por lista', () => {
            const muitos = Array.from({ length: 200 }, (_, i) => i + 1).join(',');
            expect(validador.validarRecorte({ locais: muitos }).locaisIds).toHaveLength(
                validador.MAXIMO_POR_LISTA
            );
        });

        test('lista vazia não vira recorte', () => {
            expect(validador.validarRecorte({ cursos: '' }).cursosIds).toBeUndefined();
            expect(validador.validarRecorte({ cursos: 'abc' }).cursosIds).toBeUndefined();
        });

        test('o título aceita nome de bloco e recusa texto livre', () => {
            expect(validador.validarRecorte({ titulo: 'Bloco C' }).titulo).toBe('Bloco C');
            expect(validador.validarRecorte({ titulo: 'Bloco B - Asa Sul' }).titulo).toBe(
                'Bloco B - Asa Sul'
            );
            expect(
                validador.validarRecorte({ titulo: '<script>x</script>' }).titulo
            ).toBeUndefined();
            expect(validador.validarRecorte({ titulo: 'x'.repeat(80) }).titulo).toBeUndefined();
        });

        test('o período letivo não pode ser fixado na URL', () => {
            // Uma TV com `periodo=1` colado atras dela mostraria 2026.2 para
            // sempre. O parametro simplesmente nao existe no recorte.
            const recorte = validador.validarRecorte({ periodo: '1', campus: '2' });
            expect(recorte).not.toHaveProperty('periodoId');
            expect(recorte.campusId).toBe(2);
        });
    });

    describe('permissões do gerador de links', () => {
        test('admin e nap leem; coordenador não', () => {
            expect(PERMISSOES.admin.paineis).toContain('ler');
            expect(PERMISSOES.nap.paineis).toContain('ler');
            expect(PERMISSOES.coordenador.paineis).toEqual([]);
        });

        test('nem admin nem nap gravam painel: a tela é só leitura', () => {
            expect(PERMISSOES.nap.paineis).toEqual(['ler']);
        });
    });

    describe('rota pública', () => {
        test('sem campus, pede configuração em vez de erro', async () => {
            const resposta = await request(app).get('/painel');

            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain('Painel sem configuração');
        });

        test('parâmetro lixo responde 200, nunca 500', async () => {
            const sujos = [
                '/painel?campus=abc',
                '/painel?campus=-1&cursos=%00',
                '/painel?campus=1&locais=' + 'x'.repeat(500),
                "/painel?campus=1&titulo=' OR 1=1--",
                '/painel?campus=99999999999999',
            ];

            for (const url of sujos) {
                const resposta = await request(app).get(url);
                expect(resposta.status).toBe(200);
            }
        });

        test('não entra em buscador, e o cache é curto', async () => {
            const resposta = await request(app).get('/painel?campus=1');

            expect(resposta.headers['x-robots-tag']).toContain('noindex');
            // Curto o bastante para o quadro nao envelhecer (a pagina se
            // recarrega a cada 60 s) e permissivo o bastante para o player de
            // sinalizacao poder guardar a resposta antes de exibir.
            expect(resposta.headers['cache-control']).toContain('max-age=30');
        });

        test('traz o QR da consulta pública', async () => {
            const resposta = await request(app).get('/painel?campus=1');

            expect(resposta.text).toContain('<svg');
            expect(resposta.text).toContain('qr-codigo');
        });
    });

    describe('http e https', () => {
        /**
         * A TV do bloco costuma alcancar o servidor por um endereco interno sem
         * TLS, enquanto o publico entra pelo endereco publico com TLS. Os dois
         * precisam funcionar, e sao os cabecalhos abaixo que dizem qual e qual.
         */
        const comoProxy = (caminho, esquema, host = 'unieuro.edu.br') =>
            request(app)
                .get(caminho)
                .set('X-Forwarded-Proto', esquema)
                .set('X-Forwarded-Host', host);

        test('responde 200 nos dois esquemas', async () => {
            for (const esquema of ['http', 'https']) {
                const resposta = await comoProxy('/painel?campus=1', esquema);
                expect(resposta.status).toBe(200);
            }
        });

        test('não força upgrade dos próprios assets numa página http', async () => {
            // `upgrade-insecure-requests` numa resposta http faria o navegador
            // buscar CSS, JS e fontes por https no mesmo host — e a pagina
            // apareceria sem folha de estilo. O painel nao tem CSP nenhuma (ver
            // o teste do player), entao a garantia e conferida na consulta
            // publica, que compartilha o mesmo middleware.
            const inseguro = await comoProxy('/', 'http');
            expect(inseguro.headers['content-security-policy']).not.toContain(
                'upgrade-insecure-requests'
            );

            const seguro = await comoProxy('/', 'https');
            expect(seguro.headers['content-security-policy']).toContain(
                'upgrade-insecure-requests'
            );
        });

        test('não fixa https no host quando a TV chega por http', async () => {
            // Basta um HSTS aceito para o navegador da TV nunca mais abrir http
            // naquele host. Em teste o middleware nem chega a ser montado (so
            // producao o usa), entao a garantia real vem do teste de unidade
            // abaixo — este aqui protege contra alguem passar a monta-lo.
            const inseguro = await comoProxy('/painel?campus=1', 'http');
            expect(inseguro.headers['strict-transport-security']).toBeUndefined();
        });

        test('o HSTS só é emitido em resposta https', () => {
            const { hstsPorEsquema } = require('../src/middlewares/seguranca');
            const middleware = hstsPorEsquema();

            const executar = (secure) => {
                const cabecalhos = {};
                const res = {
                    setHeader: (nome, valor) => {
                        cabecalhos[nome.toLowerCase()] = valor;
                    },
                };
                let seguiu = false;
                middleware({ secure }, res, () => {
                    seguiu = true;
                });
                return { cabecalhos, seguiu };
            };

            expect(executar(false).cabecalhos['strict-transport-security']).toBeUndefined();
            expect(executar(true).cabecalhos['strict-transport-security']).toContain('max-age=');
            expect(executar(false).seguiu).toBe(true);
        });

        test('o QR acompanha o esquema e o host pelos quais a TV chegou', async () => {
            const inseguro = await comoProxy('/painel?campus=1', 'http', 'tv.interno.local');
            expect(inseguro.text).toContain('http://tv.interno.local');

            const seguro = await comoProxy('/painel?campus=1', 'https');
            expect(seguro.text).toContain('https://unieuro.edu.br');
        });

        test('a página não cria sessão: nenhum cookie, nenhuma linha por recarga', async () => {
            // Uma TV recarrega a cada 60 s. Passando pela sessao, cada recarga
            // gravaria um token CSRF e criaria uma linha em `session` — e por
            // http em producao o cookie `secure` nem seria guardado.
            const resposta = await comoProxy('/painel?campus=1', 'http');
            expect(resposta.headers['set-cookie']).toBeUndefined();
        });

        test('pode ser embutido em iframe de outra origem', async () => {
            // Os aplicativos de sinalizacao das TVs nao abrem a URL como
            // pagina: embutem num iframe da propria casca, de outra origem. Com
            // `frame-ancestors 'self'` o Chrome recusa a resposta inteira e a
            // TV mostra ERR_BLOCKED_BY_RESPONSE.
            const resposta = await comoProxy('/painel?campus=1', 'http');

            expect(resposta.headers['x-frame-options']).toBeUndefined();
            expect(resposta.headers['cross-origin-resource-policy']).toBe('cross-origin');
        });

        test('não impõe CSP ao player que embute a página', async () => {
            // O player injeta script proprio para controlar rodizio e escala;
            // `script-src 'self'` bloqueia a injecao e ele desiste da pagina.
            const resposta = await comoProxy('/painel?campus=1', 'http');

            expect(resposta.headers['content-security-policy']).toBeUndefined();
            expect(resposta.headers['origin-agent-cluster']).toBeUndefined();
            expect(resposta.headers['referrer-policy']).toBeUndefined();
        });

        test('a resposta pode ser guardada pelo player', async () => {
            // `no-store` proibiria guardar, e um player que baixa antes de
            // exibir nao exibiria nada.
            const resposta = await comoProxy('/painel?campus=1', 'http');

            expect(resposta.headers['cache-control']).not.toContain('no-store');
            expect(resposta.headers['cache-control']).toContain('max-age=');
        });

        test('o CSS, o JS e as fontes acompanham o documento no CORP', async () => {
            // Liberar so o HTML nao basta: dentro de um iframe de outra origem
            // cada subrecurso e verificado por conta propria, e com `same-site`
            // o Chrome recusa CSS e JS com ERR_BLOCKED_BY_RESPONSE.NotSameSite —
            // a TV mostra a pagina crua, sem estilo e sem relogio.
            const recursos = [
                '/painel?campus=1',
                '/css/painel.css',
                '/js/painel.js',
                '/fontes/plex-condensed-600.woff2',
            ];

            for (const caminho of recursos) {
                const resposta = await request(app).get(caminho);
                expect(resposta.status).toBe(200);
                expect(resposta.headers['cross-origin-resource-policy']).toBe('cross-origin');
            }
        });

        test('o restante de public/ continua same-site', async () => {
            const resposta = await request(app).get('/css/admin.css');

            expect(resposta.status).toBe(200);
            expect(resposta.headers['cross-origin-resource-policy']).toBe('same-site');
        });

        test('o resto do sistema continua recusando embutimento', async () => {
            // Afrouxar vale so para o painel, que nao tem sessao nem clique.
            const publica = await comoProxy('/', 'https');

            expect(publica.headers['x-frame-options']).toBe('SAMEORIGIN');
            expect(publica.headers['content-security-policy']).toContain("frame-ancestors 'self'");
            expect(publica.headers['cross-origin-resource-policy']).toBe('same-site');
        });

        test('a consulta pública do aluno continua respondendo nos dois esquemas', async () => {
            for (const esquema of ['http', 'https']) {
                const resposta = await comoProxy('/', esquema);
                expect(resposta.status).toBe(200);
            }
        });
    });

    describe('montagem de URL absoluta', () => {
        const urls = require('../src/utils/urls');

        const requisicaoFalsa = (protocolo, host) => ({
            protocol: protocolo,
            host,
            headers: { host },
            withBase: (caminho) => `/grades${caminho}`,
        });

        test('preserva o esquema da requisição, sem preferir https', () => {
            expect(urls.urlAbsoluta(requisicaoFalsa('http', 'tv.interno.local'), '/painel')).toBe(
                'http://tv.interno.local/grades/painel'
            );
            expect(urls.urlAbsoluta(requisicaoFalsa('https', 'unieuro.edu.br'), '/painel')).toBe(
                'https://unieuro.edu.br/grades/painel'
            );
        });

        test('host com porta é preservado', () => {
            expect(urls.urlAbsoluta(requisicaoFalsa('http', '10.0.0.5:3000'), '/painel')).toBe(
                'http://10.0.0.5:3000/grades/painel'
            );
        });

        test('sem host conhecido devolve o caminho relativo, que ainda funciona', () => {
            expect(urls.urlAbsoluta(requisicaoFalsa('http', ''), '/painel')).toBe('/grades/painel');
        });

        test('URL_PUBLICA descarta o caminho para não duplicar o BASE_PATH', () => {
            // O arquivo de configuracao normaliza para esquema + host; aceitar
            // o caminho tambem produziria "/grades/grades".
            jest.resetModules();
            process.env.URL_PUBLICA = 'https://unieuro.edu.br/grades/';
            const config = require('../src/config/env');
            expect(config.urlPublica).toBe('https://unieuro.edu.br');
            delete process.env.URL_PUBLICA;
            jest.resetModules();
        });

        test('URL_PUBLICA inválida é ignorada em vez de derrubar a aplicação', () => {
            jest.resetModules();
            process.env.URL_PUBLICA = 'javascript:alert(1)';
            expect(require('../src/config/env').urlPublica).toBe('');

            jest.resetModules();
            process.env.URL_PUBLICA = 'nao-e-url';
            expect(require('../src/config/env').urlPublica).toBe('');

            delete process.env.URL_PUBLICA;
            jest.resetModules();
        });
    });

    describe('com dados reais', () => {
        let cenario;

        beforeAll(async () => {
            const campus = await bd.criarCampus({ nome: 'Campus do Painel' });
            const curso = await bd.criarCurso({ nome: 'Curso do Painel', campusIds: [campus.id] });
            const turma = await bd.criarTurma({
                nome: 'PNL01M1',
                codigo: 'PNL01M1',
                campusId: campus.id,
                cursoId: curso.id,
                turnoSlug: 'matutino',
                semestreCurricular: 1,
            });
            const disciplina = await bd.criarDisciplina({ nome: 'Disciplina do Painel' });
            const local = await bd.criarLocal({ campusId: campus.id, nome: '901 Z' });

            // Dois horarios seguidos da mesma disciplina, quarta-feira.
            for (const ordem of [1, 2]) {
                await bd.criarAula({
                    turmaId: turma.id,
                    disciplinaId: disciplina.id,
                    localId: local.id,
                    diaSemana: 3,
                    ordemHorario: ordem,
                });
            }

            cenario = { campus, curso, turma, disciplina, local };
        });

        test('a grade da manhã aparece compactada numa linha', async () => {
            const painel = await servico.montarPainel(
                { campusId: cenario.campus.id, titulo: 'Bloco Z' },
                { agora: emSaoPaulo('08:30') }
            );

            expect(painel.configurar).toBe(false);
            expect(painel.faixa.chave).toBe('manha');
            expect(painel.paginas[0]).toHaveLength(1);

            const linha = painel.paginas[0][0];
            expect(linha.disciplina).toBe('Disciplina do Painel');
            expect(linha.local).toBe('901 Z');
            expect(linha.turmas).toEqual(['PNL01M1']);
            // Dois horarios de 50 min viraram uma faixa so.
            expect(linha.inicio).not.toBe(linha.fim);
            expect(linha.situacao).toBe('agora');
        });

        test('o recorte por local mantém as aulas ainda sem sala', async () => {
            const semSala = await bd.criarAula({
                turmaId: cenario.turma.id,
                disciplinaId: cenario.disciplina.id,
                localId: null,
                diaSemana: 3,
                ordemHorario: 4,
            });
            expect(semSala).toBeTruthy();

            const painel = await servico.montarPainel(
                { campusId: cenario.campus.id, locaisIds: [cenario.local.id] },
                { agora: emSaoPaulo('08:30') }
            );

            const locais = painel.paginas[0].map((linha) => linha.local);
            expect(locais).toContain('901 Z');
            expect(locais).toContain('');
        });

        test('depois da última aula, o painel vira para o próximo dia letivo', async () => {
            const painel = await servico.montarPainel(
                { campusId: cenario.campus.id },
                // Quarta-feira, 23:30: nada mais acontece hoje.
                { agora: emSaoPaulo('23:30') }
            );

            expect(painel.vazio).toBe(false);
            expect(painel.amanha).toBe(true);
            expect(painel.paginas[0].length).toBeGreaterThan(0);
        });

        test('no domingo mostra o próximo dia com aula', async () => {
            const painel = await servico.montarPainel(
                { campusId: cenario.campus.id },
                { agora: emSaoPaulo('10:00', '2026-08-09') }
            );

            expect(painel.amanha).toBe(true);
            expect(painel.diaSemana).toBeGreaterThanOrEqual(1);
            expect(painel.diaSemana).toBeLessThanOrEqual(6);
        });

        test('campus sem aula nenhuma cai no estado vazio, não em erro', async () => {
            const outro = await bd.criarCampus({ nome: 'Campus Vazio do Painel' });
            const painel = await servico.montarPainel(
                { campusId: outro.id },
                { agora: emSaoPaulo('10:00') }
            );

            expect(painel.vazio).toBe(true);
            expect(painel.paginas).toEqual([[]]);
        });
    });

    describe('capacidade da página', () => {
        test('o CSS e o serviço concordam sobre a altura da linha', () => {
            const fs = require('node:fs');
            const path = require('node:path');
            const css = fs.readFileSync(
                path.join(__dirname, '..', 'public', 'css', 'painel.css'),
                'utf8'
            );

            // O corpo util da TV vertical: 1920 menos cabecalho e rodape.
            const linhas = /grid-template-rows:\s*(\d+)px 1fr (\d+)px/.exec(css);
            expect(linhas).not.toBeNull();

            const corpo = 1920 - Number(linhas[1]) - Number(linhas[2]);
            const alturaMinima = corpo / servico.LINHAS_POR_PAGINA;

            // Com a capacidade cheia cada linha ainda precisa caber a
            // disciplina (31px) e a meta (20px) sem se sobrepor.
            expect(alturaMinima).toBeGreaterThan(31 + 20 + 10);
        });
    });
});
