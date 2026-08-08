/**
 * Importacao da grade a partir do cubo do TOTVS.
 *
 * O que estes testes protegem, em ordem de importancia:
 *
 *  1. NAO DUPLICAR. Reimportar a mesma planilha nao pode criar um unico
 *     registro novo — e a exigencia central da funcionalidade.
 *  2. TURMA GERENCIAL. A disciplina compartilhada fica na turma que a oferta;
 *     as turmas atendidas ficam ligadas a ela sem receber copia da aula.
 *  3. INTEGRIDADE. Uma falha no meio da carga nao pode deixar meia grade
 *     gravada, e a previa nao pode gravar nada.
 */
const bd = require('./helpers/db');
const { criarApp, criarAgente, login, tokenCsrf } = require('./helpers/app');
const { montarCubo, montarXlsx, COLUNAS_CUBO } = require('./helpers/planilha');
const importacaoService = require('../src/services/importacaoService');
const { lerPrimeiraAba, ErroPlanilha } = require('../src/utils/planilha');
const cubo = require('../src/services/importacao/cuboTotvs');

/**
 * Cenario base: uma turma gerencial (GPDIRM) que oferta uma disciplina para
 * duas turmas regulares (DIR07M1 e DIR08M1), no formato exato do cubo — cada
 * aula aparece uma vez pela gerencial e uma vez por turma atendida.
 */
const planilhaCompartilhada = () =>
    montarCubo([
        // A oferta real, na turma gerencial.
        {
            CODTURMA: 'GPDIRM',
            IDTURMADISC: 194136,
            TURMA_GERENCIAL: 'Sim',
            GERENCIADA: 'NÃO',
            CURSO: null,
            CODCURSO: null,
            DISCIPLINA: 'DIREITO INTERNACIONAL',
            CODDISC: '1.001668.040',
        },
        // Espelhos: nao viram aula, apenas revelam quem e atendido.
        {
            CODTURMA: 'DIR07M1',
            IDTURMADISC: 191182,
            GERENCIADA: 'SIM',
            CODTURMA_GERENCIAL: 'GPDIRM',
            IDTURMADISC_GEREN: 194136,
            DISCIPLINA: 'DIREITO INTERNACIONAL',
            CODDISC: '1.001668.040',
        },
        {
            CODTURMA: 'DIR08M1',
            IDTURMADISC: 191198,
            GERENCIADA: 'SIM',
            CODTURMA_GERENCIAL: 'GPDIRM',
            IDTURMADISC_GEREN: 194136,
            DISCIPLINA: 'DIREITO INTERNACIONAL',
            CODDISC: '1.001668.040',
        },
    ]);

const contar = async (sql, parametros = []) => {
    const resultado = await bd.query(sql, parametros);
    return Number(resultado.rows[0].total);
};

const totalPorTabela = async () => ({
    campus: await contar('SELECT COUNT(*)::int AS total FROM campus'),
    cursos: await contar('SELECT COUNT(*)::int AS total FROM cursos'),
    disciplinas: await contar('SELECT COUNT(*)::int AS total FROM disciplinas'),
    professores: await contar('SELECT COUNT(*)::int AS total FROM professores'),
    turmas: await contar('SELECT COUNT(*)::int AS total FROM turmas'),
    aulas: await contar('SELECT COUNT(*)::int AS total FROM aulas'),
    equipes: await contar('SELECT COUNT(*)::int AS total FROM aula_professores'),
    horarios: await contar('SELECT COUNT(*)::int AS total FROM horarios_turno'),
});

describe('Importacao do cubo do TOTVS', () => {
    /**
     * Ids dos periodos que vieram do seed.
     *
     * A carga cria periodos nos turnos para acomodar a planilha, e
     * `limparDados()` preserva `horarios_turno` de proposito (e carga
     * estrutural, nao dado de teste). Sem restaurar, um periodo criado aqui
     * apareceria na grade dos outros arquivos de teste.
     */
    let horariosDoSeed = [];

    // As aulas referenciam `horarios_turno` (FK RESTRICT): limpar os dados antes
    // de devolver os turnos ao estado do seed.
    const restaurarHorariosDoSeed = async () => {
        await bd.limparDados();
        await bd.query('DELETE FROM horarios_turno WHERE NOT (id = ANY($1::int[]))', [
            horariosDoSeed,
        ]);
    };

    beforeAll(async () => {
        const resultado = await bd.query('SELECT id FROM horarios_turno ORDER BY id');
        horariosDoSeed = resultado.rows.map((linha) => linha.id);
    });

    beforeEach(async () => {
        await restaurarHorariosDoSeed();
    });

    afterAll(async () => {
        await restaurarHorariosDoSeed();
        await bd.encerrar();
    });

    // -----------------------------------------------------------------------
    describe('leitura do arquivo', () => {
        it('le uma planilha .xlsx com textos compartilhados', () => {
            const arquivo = montarXlsx(
                ['A', 'B'],
                [
                    ['um', 2],
                    ['três', null],
                ]
            );
            const { cabecalho, linhas } = lerPrimeiraAba(arquivo);

            expect(cabecalho).toEqual(['A', 'B']);
            expect(linhas).toHaveLength(2);
            expect(linhas[0].A).toBe('um');
            expect(linhas[0].B).toBe(2);
            expect(linhas[1].A).toBe('três');
            expect(linhas[1].B).toBeNull();
        });

        it('recusa arquivo que nao e .xlsx com mensagem propria', () => {
            expect(() => lerPrimeiraAba(Buffer.from('isto nao e uma planilha'))).toThrow(
                ErroPlanilha
            );
        });

        it('recusa planilha sem as colunas do cubo', () => {
            const arquivo = montarXlsx(['COLUNA'], [['valor']]);

            expect(() => importacaoService.interpretarArquivo(arquivo)).toThrow(
                /formato esperado/i
            );
        });
    });

    // -----------------------------------------------------------------------
    describe('interpretacao das regras do cubo', () => {
        it('descarta as linhas espelho e mantem a aula na turma que oferta', () => {
            const { linhas } = lerPrimeiraAba(planilhaCompartilhada());
            const resultado = cubo.interpretar(linhas);

            expect(resultado.totais.linhasLidas).toBe(3);
            expect(resultado.totais.linhasEspelho).toBe(2);
            expect(resultado.totais.linhasConsideradas).toBe(1);
            expect(resultado.aulas).toHaveLength(1);
            // A aula fica na turma do grupo, nao no codigo gerencial cru.
            expect(resultado.aulas[0].turmaRef).toContain('GPDIRM.DIR07M1.2');
        });

        it('cria as turmas atendidas e as liga a turma que oferta', () => {
            const { linhas } = lerPrimeiraAba(planilhaCompartilhada());
            const { turmas } = cubo.interpretar(linhas);

            // A gerencial vira UMA turma por grupo de turmas que estudam
            // juntas — aqui, o grupo {DIR07M1, DIR08M1}.
            const grupo = turmas.find((turma) => turma.gerencial);
            const atendida = turmas.find((turma) => turma.codigo === 'DIR08M1');

            expect(grupo.codigo).toBe('GPDIRM.DIR07M1.2');
            expect(grupo.grupoDe).toBe('GPDIRM');
            expect(grupo.codigosDoGrupo).toEqual(['DIR07M1', 'DIR08M1']);
            expect(grupo.semestresDoGrupo).toEqual([7, 8]);
            expect(grupo.membros).toHaveLength(2);
            expect(atendida.gerencialDe).toBe(grupo.id);
            expect(atendida.totalAulas).toBe(0);
        });

        it('deduz o curso da turma gerencial pelas turmas que ela atende', () => {
            const { linhas } = lerPrimeiraAba(planilhaCompartilhada());
            const { turmas, cursos } = cubo.interpretar(linhas);

            const gerencial = turmas.find((turma) => turma.gerencial);

            expect(cursos).toHaveLength(1);
            expect(cursos[0].codigo).toBe('10006');
            expect(gerencial.cursoId).toBe('10006');
        });

        it('deduz semestre e turno do codigo da turma', () => {
            expect(cubo.semestreDoCodigo('DIR08M1')).toBe(8);
            expect(cubo.semestreDoCodigo('ODO10I2')).toBe(10);
            // Turma gerencial e turma especial nao tem semestre.
            expect(cubo.semestreDoCodigo('GPDIRM')).toBeNull();
            expect(cubo.semestreDoCodigo('DIRESPM1')).toBeNull();

            expect(cubo.turnoDoCodigo('DIR08M1')).toBe('matutino');
            expect(cubo.turnoDoCodigo('DIR08N1')).toBe('noturno');
            expect(cubo.turnoDoCodigo('ODO09I1')).toBe('integral');
        });

        it('deduz o curso pela sigla do codigo, como em DIR = Direito', () => {
            expect(cubo.siglaDoCodigo('DIR08M1')).toBe('DIR');
            expect(cubo.siglaDoCodigo('GPDIRM')).toBe('DIR');
            expect(cubo.siglaDoCodigo('GPODOI')).toBe('ODO');
            expect(cubo.siglaDoCodigo('ODO10I2')).toBe('ODO');
        });

        it('reune os professores da mesma aula em vez de repeti-la', () => {
            const arquivo = montarCubo([
                { CHAPA: '000111', NOME: 'PROFESSORA TITULAR', TIPO_PROF: 'Titular' },
                { CHAPA: '000222', NOME: 'PROFESSOR AUXILIAR', TIPO_PROF: 'Coordenador' },
            ]);

            const { linhas } = lerPrimeiraAba(arquivo);
            const { aulas, professores } = cubo.interpretar(linhas);

            expect(aulas).toHaveLength(1);
            expect(professores).toHaveLength(2);
            expect(aulas[0].professores).toHaveLength(2);
            // Titular assume a aula; o restante da equipe fica registrado.
            expect(aulas[0].professorPrincipal.matricula).toBe('000111');
        });
    });

    // -----------------------------------------------------------------------
    describe('presencial e EAD', () => {
        /**
         * Bloco de uma disciplina so: `tempos` linhas seguidas na mesma turma,
         * variando apenas o horario.
         */
        const bloco = (tempos, extra = {}) =>
            montarCubo(
                tempos.map(([inicio, fim]) => ({
                    HORAINICIAL: inicio,
                    HORAFINAL: fim,
                    ...extra,
                }))
            );

        const porHora = (resultado) =>
            Object.fromEntries(resultado.aulas.map((aula) => [aula.horaInicio, aula.presencial]));

        it('mantem os ultimos tempos do bloco, na quantidade que AULAS_SEMANA declara', () => {
            const { linhas } = lerPrimeiraAba(
                bloco(
                    [
                        ['08:00', '08:50'],
                        ['08:50', '09:40'],
                        ['09:50', '10:40'],
                        ['10:40', '11:30'],
                    ],
                    { AULAS_SEMANA: 2 }
                )
            );

            const resultado = cubo.interpretar(linhas);

            expect(porHora(resultado)).toEqual({
                '08:00': false,
                '08:50': false,
                '09:50': true,
                '10:40': true,
            });
            expect(resultado.totais.aulasPresenciais).toBe(2);
            expect(resultado.totais.aulasEad).toBe(2);
        });

        it('marca a aula EAD com a modalidade correspondente', () => {
            const { linhas } = lerPrimeiraAba(
                bloco(
                    [
                        ['08:00', '08:50'],
                        ['08:50', '09:40'],
                    ],
                    { AULAS_SEMANA: 1 }
                )
            );

            const { aulas } = cubo.interpretar(linhas);
            const primeira = aulas.find((aula) => aula.horaInicio === '08:00');

            expect(primeira.presencial).toBe(false);
            expect(primeira.modalidade).toBe('ead');
        });

        it('cai para TOTAL_HORAS / 4,5 quando a planilha nao traz AULAS_SEMANA', () => {
            const { linhas } = lerPrimeiraAba(
                bloco(
                    [
                        ['08:00', '08:50'],
                        ['08:50', '09:40'],
                        ['09:50', '10:40'],
                    ],
                    { TOTAL_HORAS: 4.5 }
                )
            );

            expect(porHora(cubo.interpretar(linhas))).toEqual({
                '08:00': false,
                '08:50': false,
                '09:50': true,
            });
        });

        /**
         * O mesmo bloco repetido no sabado, como o cubo passou a exportar em
         * 08/08/2026: mesmos horarios, mesmo professor, `Presencial`. E o tempo
         * alternativo da aula quinzenal, nao um segundo encontro.
         */
        const blocoComSabado = (tempos, extra = {}) =>
            montarCubo(
                tempos.flatMap(([inicio, fim]) =>
                    ['Segunda-Feira', 'Sábado'].map((dia) => ({
                        SEMANA: dia,
                        HORAINICIAL: inicio,
                        HORAFINAL: fim,
                        ...extra,
                    }))
                )
            );

        const porDiaEHora = (resultado) =>
            Object.fromEntries(
                resultado.aulas.map((aula) => [
                    `${aula.diaSemana}|${aula.horaInicio}`,
                    aula.presencial,
                ])
            );

        it('nunca deixa aula presencial no sabado quando o bloco tem dia util', () => {
            const { linhas } = lerPrimeiraAba(
                blocoComSabado(
                    [
                        ['08:00', '08:50'],
                        ['08:50', '09:40'],
                    ],
                    { AULAS_SEMANA: 2 }
                )
            );

            // Sem a regra, o sabado venceria o desempate por ser o ultimo dia e
            // levaria o encontro presencial junto.
            expect(porDiaEHora(cubo.interpretar(linhas))).toEqual({
                '1|08:00': true,
                '1|08:50': true,
                '6|08:00': false,
                '6|08:50': false,
            });
        });

        it('mantem presencial a disciplina que so tem tempo no sabado', () => {
            const { linhas } = lerPrimeiraAba(
                montarCubo([
                    { SEMANA: 'Sábado', HORAINICIAL: '08:00', HORAFINAL: '08:50', AULAS_SEMANA: 1 },
                ])
            );

            const resultado = cubo.interpretar(linhas);

            // Marcar como EAD apagaria a disciplina da grade — melhor avisar.
            expect(resultado.aulas[0].presencial).toBe(true);
            expect(resultado.avisos.map((aviso) => aviso.tipo)).toContain(
                'oferta_so_em_horario_ead'
            );
        });

        it('nunca deixa aula presencial as 18:10, mesmo se a quantidade permitisse', () => {
            const { linhas } = lerPrimeiraAba(
                bloco(
                    [
                        ['18:10', '19:00'],
                        ['19:00', '19:50'],
                        ['19:50', '20:40'],
                    ],
                    {
                        CODTURMA: 'DIR01N1',
                        'TURNO DISCIPLINA': 'NOTURNO',
                        AULAS_SEMANA: 3,
                    }
                )
            );

            expect(porHora(cubo.interpretar(linhas))).toEqual({
                '18:10': false,
                '19:00': true,
                '19:50': true,
            });
        });

        it('trata as 07:10 como EAD, exceto em Odontologia', () => {
            const tempos = [
                ['07:10', '08:00'],
                ['08:00', '08:50'],
            ];

            const { linhas: comuns } = lerPrimeiraAba(bloco(tempos));
            expect(porHora(cubo.interpretar(comuns))).toEqual({
                '07:10': false,
                '08:00': true,
            });

            const { linhas: odonto } = lerPrimeiraAba(
                bloco(tempos, {
                    CODTURMA: 'ODO03I1',
                    CURSO: 'ODONTOLOGIA',
                    CODCURSO: '10020',
                    'TURNO DISCIPLINA': 'INTEGRAL',
                })
            );
            expect(porHora(cubo.interpretar(odonto))).toEqual({
                '07:10': true,
                '08:00': true,
            });
        });

        it('mantem presencial a disciplina que so tem tempo em horario de EAD', () => {
            const { linhas } = lerPrimeiraAba(
                bloco([['18:10', '19:00']], {
                    CODTURMA: 'DIR01N1',
                    'TURNO DISCIPLINA': 'NOTURNO',
                    AULAS_SEMANA: 1,
                })
            );

            const resultado = cubo.interpretar(linhas);

            // Marcar como EAD apagaria a disciplina da grade — melhor avisar.
            expect(resultado.aulas[0].presencial).toBe(true);
            expect(resultado.avisos.map((aviso) => aviso.tipo)).toContain(
                'oferta_so_em_horario_ead'
            );
        });

        it('deixa tudo presencial quando a planilha nao declara a quantidade', () => {
            const { linhas } = lerPrimeiraAba(
                bloco([
                    ['08:00', '08:50'],
                    ['08:50', '09:40'],
                ])
            );

            const resultado = cubo.interpretar(linhas);

            expect(porHora(resultado)).toEqual({ '08:00': true, '08:50': true });
            expect(resultado.totais.aulasEad).toBe(0);
            expect(resultado.avisos.map((aviso) => aviso.tipo)).toContain(
                'oferta_sem_aulas_semana'
            );
        });

        it('usa o maior AULAS_SEMANA entre os professores da mesma aula', () => {
            // Co-docencia: cada professor traz a sua carga; vale a do que cobre
            // o bloco inteiro.
            const { linhas } = lerPrimeiraAba(
                montarCubo([
                    { HORAINICIAL: '08:00', HORAFINAL: '08:50', AULAS_SEMANA: 1, CHAPA: '000100' },
                    { HORAINICIAL: '08:00', HORAFINAL: '08:50', AULAS_SEMANA: 2, CHAPA: '000200' },
                    { HORAINICIAL: '08:50', HORAFINAL: '09:40', AULAS_SEMANA: 1, CHAPA: '000100' },
                    { HORAINICIAL: '08:50', HORAFINAL: '09:40', AULAS_SEMANA: 2, CHAPA: '000200' },
                    { HORAINICIAL: '09:50', HORAFINAL: '10:40', AULAS_SEMANA: 2, CHAPA: '000200' },
                ])
            );

            expect(porHora(cubo.interpretar(linhas))).toEqual({
                '08:00': false,
                '08:50': true,
                '09:50': true,
            });
        });

        it('grava a aula EAD inativa e fora da grade da turma', async () => {
            const relatorio = await importacaoService.aplicar(
                bloco(
                    [
                        ['08:00', '08:50'],
                        ['08:50', '09:40'],
                        ['09:50', '10:40'],
                    ],
                    { AULAS_SEMANA: 1 }
                )
            );

            expect(relatorio.aulas.gravadas).toBe(3);
            expect(relatorio.aulas.presenciais).toBe(1);
            expect(relatorio.aulas.ead).toBe(2);
            // A sala so e cobrada das aulas que acontecem presencialmente.
            expect(relatorio.aulas.semLocal).toBe(1);

            const gravadas = await bd.query(
                `SELECT h.hora_inicio, a.ativo, a.modalidade
                   FROM aulas a JOIN horarios_turno h ON h.id = a.horario_turno_id
                  ORDER BY h.hora_inicio`
            );

            expect(
                gravadas.rows.map((linha) => [
                    String(linha.hora_inicio),
                    linha.ativo,
                    linha.modalidade,
                ])
            ).toEqual([
                ['08:00:00', false, 'ead'],
                ['08:50:00', false, 'ead'],
                ['09:50:00', true, 'presencial'],
            ]);

            // A grade da turma enxerga apenas a aula presencial.
            expect(
                await contar(
                    `SELECT COUNT(*)::int AS total
                       FROM vw_aulas_das_turmas v
                       JOIN aulas a ON a.id = v.aula_id AND a.ativo`
                )
            ).toBe(1);
        });

        it('reimportar mantem a classificacao, sem duplicar', async () => {
            const planilha = () =>
                bloco(
                    [
                        ['08:00', '08:50'],
                        ['08:50', '09:40'],
                    ],
                    { AULAS_SEMANA: 1 }
                );

            await importacaoService.aplicar(planilha());
            const segunda = await importacaoService.aplicar(planilha());

            expect(segunda.aulas.novas).toBe(0);
            expect(segunda.aulas.ead).toBe(1);
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas')).toBe(2);
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas WHERE ativo')).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    describe('simulacao', () => {
        it('nao grava nada e informa o que aconteceria', async () => {
            const antes = await totalPorTabela();

            const relatorio = await importacaoService.simular(planilhaCompartilhada());

            expect(relatorio.simulacao).toBe(true);
            expect(relatorio.aulas.novas).toBe(1);
            expect(relatorio.contagens.turmasCriadas).toBe(3);
            expect(await totalPorTabela()).toEqual(antes);
        });

        it('detecta o periodo letivo pelas datas da planilha', async () => {
            const relatorio = await importacaoService.simular(planilhaCompartilhada());

            expect(relatorio.detectado).toBe('2026.2');
            expect(relatorio.periodo.codigo).toBe('2026.2');
        });
    });

    // -----------------------------------------------------------------------
    describe('gravacao', () => {
        it('cria a grade completa a partir da planilha', async () => {
            const relatorio = await importacaoService.aplicar(planilhaCompartilhada(), {
                arquivo: 'cubo.xlsx',
            });

            expect(relatorio.simulacao).toBe(false);
            expect(relatorio.aulas.novas).toBe(1);

            const totais = await totalPorTabela();
            expect(totais.turmas).toBe(3);
            expect(totais.aulas).toBe(1);
            expect(totais.disciplinas).toBe(1);
            expect(totais.professores).toBe(1);

            const aula = await bd.query(
                `SELECT a.origem, a.origem_chave, t.codigo AS turma, t.nome, t.gerencial
                   FROM aulas a JOIN turmas t ON t.id = a.turma_id`
            );
            expect(aula.rows[0].origem).toBe('totvs');
            expect(aula.rows[0].turma).toBe('GPDIRM.DIR07M1.2');
            expect(aula.rows[0].nome).toBe('GPDIRM (DIR07M1 | DIR08M1)');
            expect(aula.rows[0].gerencial).toBe(true);
        });

        it('nao replica a disciplina compartilhada nas turmas atendidas', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            const aulasPorTurma = await bd.query(
                `SELECT t.codigo, COUNT(a.id)::int AS aulas
                   FROM turmas t LEFT JOIN aulas a ON a.turma_id = t.id
                  GROUP BY t.codigo ORDER BY t.codigo`
            );

            expect(aulasPorTurma.rows).toEqual([
                { codigo: 'DIR07M1', aulas: 0 },
                { codigo: 'DIR08M1', aulas: 0 },
                { codigo: 'GPDIRM.DIR07M1.2', aulas: 1 },
            ]);
        });

        it('faz a disciplina compartilhada aparecer na grade de cada turma que a cursa', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            // Um unico registro de aula...
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas')).toBe(1);

            // ...enxergado pela grade das duas turmas, cada uma no seu semestre.
            const grade = await bd.query(
                `SELECT t.codigo, t.semestre_curricular AS semestre, v.propria, d.nome AS disciplina
                   FROM turmas t
                   JOIN vw_aulas_das_turmas v ON v.turma_id = t.id
                   JOIN aulas a ON a.id = v.aula_id
                   JOIN disciplinas d ON d.id = a.disciplina_id
                  WHERE NOT t.gerencial
                  ORDER BY t.codigo`
            );

            expect(grade.rows).toEqual([
                {
                    codigo: 'DIR07M1',
                    semestre: 7,
                    propria: false,
                    disciplina: 'Direito Internacional',
                },
                {
                    codigo: 'DIR08M1',
                    semestre: 8,
                    propria: false,
                    disciplina: 'Direito Internacional',
                },
            ]);
        });

        it('so leva a aula para as turmas daquela oferta, nao para todas da gerencial', async () => {
            // GPDIRM atende DIR01M1 e DIR08M1, mas cada disciplina serve a uma
            // delas. O 1o semestre nao pode receber a optativa do 8o.
            await importacaoService.aplicar(
                montarCubo([
                    {
                        CODTURMA: 'GPDIRM',
                        TURMA_GERENCIAL: 'Sim',
                        IDTURMADISC: 700001,
                        CODDISC: '1.000700.040',
                        DISCIPLINA: 'DISCIPLINA DO OITAVO',
                    },
                    {
                        CODTURMA: 'DIR08M1',
                        GERENCIADA: 'SIM',
                        CODTURMA_GERENCIAL: 'GPDIRM',
                        IDTURMADISC_GEREN: 700001,
                        IDTURMADISC: 700011,
                        CODDISC: '1.000700.040',
                        DISCIPLINA: 'DISCIPLINA DO OITAVO',
                    },
                    {
                        CODTURMA: 'GPDIRM',
                        TURMA_GERENCIAL: 'Sim',
                        IDTURMADISC: 700002,
                        CODDISC: '1.000800.040',
                        DISCIPLINA: 'DISCIPLINA DO PRIMEIRO',
                        HORAINICIAL: '08:50',
                        HORAFINAL: '09:40',
                    },
                    {
                        CODTURMA: 'DIR01M1',
                        GERENCIADA: 'SIM',
                        CODTURMA_GERENCIAL: 'GPDIRM',
                        IDTURMADISC_GEREN: 700002,
                        IDTURMADISC: 700012,
                        CODDISC: '1.000800.040',
                        DISCIPLINA: 'DISCIPLINA DO PRIMEIRO',
                        HORAINICIAL: '08:50',
                        HORAFINAL: '09:40',
                    },
                ])
            );

            const grade = await bd.query(
                `SELECT t.codigo, d.nome AS disciplina
                   FROM turmas t
                   JOIN vw_aulas_das_turmas v ON v.turma_id = t.id
                   JOIN aulas a ON a.id = v.aula_id
                   JOIN disciplinas d ON d.id = a.disciplina_id
                  WHERE NOT t.gerencial
                  ORDER BY t.codigo`
            );

            expect(grade.rows).toEqual([
                { codigo: 'DIR01M1', disciplina: 'Disciplina do Primeiro' },
                { codigo: 'DIR08M1', disciplina: 'Disciplina do Oitavo' },
            ]);
        });

        it('a turma gerencial nao aparece na consulta publica', async () => {
            const gradePublica = require('../src/services/gradePublicaService');
            await importacaoService.aplicar(planilhaCompartilhada());

            // O recorte vem das proprias turmas importadas: o periodo "atual" e
            // estado global do banco e nao deve influenciar este teste.
            const recorte = await bd.query(
                `SELECT periodo_letivo_id, campus_id, curso_id
                   FROM turmas WHERE codigo = 'DIR08M1' LIMIT 1`
            );

            const resultado = await gradePublica.montarConsulta({
                periodoId: recorte.rows[0].periodo_letivo_id,
                campusId: recorte.rows[0].campus_id,
                cursoId: recorte.rows[0].curso_id,
            });

            const nomes = resultado.opcoes.turmas.map((turma) => turma.nome);

            // O aluno encontra a turma dele; a gerencial e registro interno.
            expect(nomes).toEqual(expect.arrayContaining(['DIR07M1', 'DIR08M1']));
            expect(nomes.some((nome) => String(nome).startsWith('GP'))).toBe(false);

            // E a disciplina compartilhada chega na grade das duas.
            const comAula = resultado.turmas
                .flatMap((grupo) => grupo.turmas)
                .filter((turma) => turma.totalAulas > 0)
                .map((turma) => turma.nome)
                .sort();
            expect(comAula).toEqual(['DIR07M1', 'DIR08M1']);
        });

        it('liga as turmas atendidas a turma que oferta as disciplinas', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            const vinculos = await bd.query(
                `SELECT t.codigo, g.codigo AS gerencial
                   FROM turmas t
                   JOIN turmas g ON g.id = t.turma_gerencial_id
                  ORDER BY t.codigo`
            );

            expect(vinculos.rows).toEqual([
                { codigo: 'DIR07M1', gerencial: 'GPDIRM.DIR07M1.2' },
                { codigo: 'DIR08M1', gerencial: 'GPDIRM.DIR07M1.2' },
            ]);
        });

        it('grava a equipe completa quando a aula tem mais de um professor', async () => {
            await importacaoService.aplicar(
                montarCubo([
                    { CHAPA: '000111', NOME: 'PROFESSORA TITULAR', TIPO_PROF: 'Titular' },
                    { CHAPA: '000222', NOME: 'PROFESSOR AUXILIAR', TIPO_PROF: 'Coordenador' },
                    { CHAPA: '000333', NOME: 'PROFESSOR SUBSTITUTO', TIPO_PROF: 'Substituto' },
                ])
            );

            const aulas = await contar('SELECT COUNT(*)::int AS total FROM aulas');
            const equipe = await bd.query(
                `SELECT p.matricula, ap.papel
                   FROM aula_professores ap
                   JOIN professores p ON p.id = ap.professor_id
                  ORDER BY p.matricula`
            );

            expect(aulas).toBe(1);
            expect(equipe.rows).toEqual([
                { matricula: '000111', papel: 'titular' },
                { matricula: '000222', papel: 'coordenador' },
                { matricula: '000333', papel: 'substituto' },
            ]);
        });

        it('trata o mesmo codigo de turma em filiais diferentes como turmas distintas', async () => {
            await importacaoService.aplicar(
                montarCubo([
                    { FILIAL: 'EUROAM - AGUAS CLARAS', CODTURMA: 'DIR01M1', IDTURMADISC: 900001 },
                    {
                        FILIAL: 'EUROAM - MATRIZ ASA SUL',
                        CODTURMA: 'DIR01M1',
                        IDTURMADISC: 900002,
                        HORAINICIAL: '08:50',
                        HORAFINAL: '09:40',
                    },
                ])
            );

            const turmas = await bd.query(
                `SELECT t.codigo, c.codigo_externo AS filial
                   FROM turmas t JOIN campus c ON c.id = t.campus_id
                  ORDER BY c.codigo_externo`
            );

            expect(turmas.rows).toHaveLength(2);
            expect(turmas.rows.map((linha) => linha.codigo)).toEqual(['DIR01M1', 'DIR01M1']);
            expect(turmas.rows.map((linha) => linha.filial)).toEqual([
                'EUROAM - AGUAS CLARAS',
                'EUROAM - MATRIZ ASA SUL',
            ]);
        });

        it('cria o campus a partir da filial quando ele ainda nao existe', async () => {
            await importacaoService.aplicar(montarCubo([{}]));

            const campus = await bd.query('SELECT nome, sigla, codigo_externo FROM campus');

            // O nome sai do texto da filial, sem o prefixo do ERP. Acentuacao nao
            // e inventada: o operador renomeia se quiser, e o vinculo continua
            // valendo porque e feito pelo codigo externo.
            expect(campus.rows).toEqual([
                { nome: 'Aguas Claras', sigla: 'AC', codigo_externo: 'EUROAM - AGUAS CLARAS' },
            ]);
        });

        it('registra a carga no historico', async () => {
            await importacaoService.aplicar(planilhaCompartilhada(), { arquivo: 'cubo.xlsx' });

            const historico = await importacaoService.historico(5);

            expect(historico).toHaveLength(1);
            expect(historico[0].arquivo).toBe('cubo.xlsx');
            expect(historico[0].linhas_consideradas).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    describe('idempotencia', () => {
        it('reimportar a mesma planilha nao cria nenhum registro novo', async () => {
            const arquivo = planilhaCompartilhada();

            await importacaoService.aplicar(arquivo);
            const depoisDaPrimeira = await totalPorTabela();

            const relatorio = await importacaoService.aplicar(arquivo);
            const depoisDaSegunda = await totalPorTabela();

            expect(depoisDaSegunda).toEqual(depoisDaPrimeira);
            expect(relatorio.aulas.novas).toBe(0);
            expect(relatorio.aulas.atualizadas).toBe(1);
        });

        it('atualiza a aula existente quando o professor muda na origem', async () => {
            await importacaoService.aplicar(
                montarCubo([{ CHAPA: '000111', NOME: 'PROFESSORA ANTIGA' }])
            );

            await importacaoService.aplicar(
                montarCubo([{ CHAPA: '000222', NOME: 'PROFESSOR NOVO' }])
            );

            const aulas = await bd.query(
                `SELECT p.matricula
                   FROM aulas a JOIN professores p ON p.id = a.professor_id`
            );

            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas')).toBe(1);
            expect(aulas.rows[0].matricula).toBe('000222');
            // A equipe acompanha: o professor anterior sai do vinculo.
            expect(await contar('SELECT COUNT(*)::int AS total FROM aula_professores')).toBe(1);
        });

        it('inativa aulas que sairam da planilha somente quando pedido', async () => {
            const completa = montarCubo([
                { IDTURMADISC: 900001, HORAINICIAL: '08:00', HORAFINAL: '08:50' },
                { IDTURMADISC: 900002, HORAINICIAL: '08:50', HORAFINAL: '09:40' },
            ]);
            const reduzida = montarCubo([
                { IDTURMADISC: 900001, HORAINICIAL: '08:00', HORAFINAL: '08:50' },
            ]);

            await importacaoService.aplicar(completa);
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas WHERE ativo')).toBe(2);

            // Sem a opcao marcada, a aula ausente continua ativa.
            await importacaoService.aplicar(reduzida, { inativarAusentes: false });
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas WHERE ativo')).toBe(2);

            await importacaoService.aplicar(reduzida, { inativarAusentes: true });
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas WHERE ativo')).toBe(1);
            // Inativa, nunca apaga: o historico permanece.
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas')).toBe(2);
        });

        it('reconhece campus e professor ja cadastrados a mao, sem duplicar', async () => {
            const campus = await bd.query(
                `INSERT INTO campus (nome, sigla, ativo) VALUES ('Águas Claras', 'AC', TRUE)
                 RETURNING id`
            );
            await bd.query(
                `INSERT INTO professores (nome, ativo) VALUES ('Professor de Teste', TRUE)`
            );

            await importacaoService.aplicar(montarCubo([{}]));

            expect(await contar('SELECT COUNT(*)::int AS total FROM campus')).toBe(1);
            expect(await contar('SELECT COUNT(*)::int AS total FROM professores')).toBe(1);

            const vinculado = await bd.query('SELECT codigo_externo FROM campus WHERE id = $1', [
                campus.rows[0].id,
            ]);
            expect(vinculado.rows[0].codigo_externo).toBe('EUROAM - AGUAS CLARAS');

            const professor = await bd.query('SELECT matricula FROM professores');
            expect(professor.rows[0].matricula).toBe('000100');
        });
    });

    // -----------------------------------------------------------------------
    describe('horarios', () => {
        it('cria no turno o periodo de 50 minutos que a planilha exige', async () => {
            // 11:30-12:20 nao existe no matutino da carga inicial.
            const relatorio = await importacaoService.aplicar(
                montarCubo([{ HORAINICIAL: '11:30', HORAFINAL: '12:20' }])
            );

            expect(relatorio.contagens.horariosCriados).toBe(1);

            const horario = await bd.query(
                `SELECT TO_CHAR(h.hora_inicio, 'HH24:MI') AS inicio, h.nome, h.ordem
                   FROM aulas a JOIN horarios_turno h ON h.id = a.horario_turno_id`
            );
            expect(horario.rows[0].inicio).toBe('11:30');
            // Entra numerado na sequencia do turno, nao como "novo horário".
            expect(horario.rows[0].nome).toBe('6º horário');
            expect(horario.rows[0].ordem).toBe(6);
        });

        it('encaixa faixa levemente deslocada no periodo existente', async () => {
            // 09:55-10:45 nao e periodo do turno, mas cobre 09:50-10:40.
            await importacaoService.aplicar(
                montarCubo([{ HORAINICIAL: '09:55', HORAFINAL: '10:45' }])
            );

            const horario = await bd.query(
                `SELECT TO_CHAR(h.hora_inicio, 'HH24:MI') AS inicio
                   FROM aulas a JOIN horarios_turno h ON h.id = a.horario_turno_id`
            );
            expect(horario.rows[0].inicio).toBe('09:50');
        });

        it('deriva um periodo de 50 minutos para a faixa de 60 do cubo', async () => {
            // 14:30-15:30 dura 60 min: o CHECK do banco nao aceita como periodo.
            // Alinhar ao inicio colidiria com 13:50-14:40, entao vale o
            // alinhamento ao fim (14:40-15:30). O resultado nao pode depender de
            // outra turma ter pedido essa faixa antes.
            const relatorio = await importacaoService.aplicar(
                montarCubo([
                    { HORAINICIAL: '13:50', HORAFINAL: '14:40', IDTURMADISC: 950001 },
                    {
                        HORAINICIAL: '14:30',
                        HORAFINAL: '15:30',
                        IDTURMADISC: 950002,
                        SEMANA: 'Terça-Feira',
                    },
                ])
            );

            expect(relatorio.aulas.semHorario).toBe(0);

            const horarios = await bd.query(
                `SELECT TO_CHAR(h.hora_inicio, 'HH24:MI') AS inicio,
                        TO_CHAR(h.hora_fim, 'HH24:MI') AS fim
                   FROM aulas a
                   JOIN horarios_turno h ON h.id = a.horario_turno_id
                  ORDER BY a.dia_semana`
            );

            expect(horarios.rows).toEqual([
                { inicio: '13:50', fim: '14:40' },
                { inicio: '14:40', fim: '15:30' },
            ]);
        });

        it('deixa como pendencia a faixa que nao corresponde a nenhum periodo', async () => {
            // Tres horas nao descrevem um periodo de aula: derivar 50 minutos
            // dali seria arbitrario, entao a aula entra como pendencia visivel.
            const relatorio = await importacaoService.aplicar(
                montarCubo([{ HORAINICIAL: '05:00', HORAFINAL: '08:00' }])
            );

            expect(relatorio.aulas.semHorario).toBe(1);
            expect(relatorio.avisos.some((aviso) => aviso.tipo === 'aula_sem_horario')).toBe(true);

            const aula = await bd.query('SELECT horario_turno_id FROM aulas');
            expect(aula.rows[0].horario_turno_id).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    describe('turma gerencial na grade', () => {
        it('aceita disciplinas em paralelo na turma que oferta', async () => {
            await importacaoService.aplicar(
                montarCubo([
                    {
                        CODTURMA: 'GPDIRM',
                        TURMA_GERENCIAL: 'Sim',
                        IDTURMADISC: 900001,
                        CODDISC: '1.000001.040',
                        DISCIPLINA: 'OPTATIVA UM',
                    },
                    {
                        CODTURMA: 'GPDIRM',
                        TURMA_GERENCIAL: 'Sim',
                        IDTURMADISC: 900002,
                        CODDISC: '1.000002.040',
                        DISCIPLINA: 'OPTATIVA DOIS',
                    },
                ])
            );

            const paralelas = await bd.query(
                `SELECT COUNT(*)::int AS total
                   FROM aulas a JOIN turmas t ON t.id = a.turma_id
                  WHERE t.codigo = 'GPDIRM' AND a.dia_semana = 1 AND a.ativo`
            );

            expect(Number(paralelas.rows[0].total)).toBe(2);
        });

        it('continua recusando duas aulas no mesmo horario em turma regular', async () => {
            const aulaService = require('../src/services/aulaService');
            const turma = await bd.criarTurma();
            const horario = await bd.horarioDoTurno('matutino', 1);
            const primeira = await bd.criarDisciplina();
            const segunda = await bd.criarDisciplina();

            await aulaService.criar({
                turmaId: turma.id,
                disciplinaId: primeira.id,
                diaSemana: 1,
                horarioTurnoId: horario.id,
            });

            await expect(
                aulaService.criar({
                    turmaId: turma.id,
                    disciplinaId: segunda.id,
                    diaSemana: 1,
                    horarioTurnoId: horario.id,
                })
            ).rejects.toThrow(/já possui aula/i);
        });
    });

    // -----------------------------------------------------------------------
    describe('grade da turma gerencial no painel', () => {
        const aulaService = require('../src/services/aulaService');

        /**
         * Duas turmas do MESMO grupo ({DIR07M1, DIR08M1}) com duas disciplinas.
         * E o formato real do cubo: a turma gerencial concentra as disciplinas que
         * essas duas turmas cursam juntas.
         */
        const cenarioGrupo = async () => {
            await importacaoService.aplicar(
                montarCubo([
                    ...[
                        { oferta: 900001, disc: '1.000901.040', nome: 'PRIMEIRA COMPARTILHADA' },
                        {
                            oferta: 900002,
                            disc: '1.000902.040',
                            nome: 'SEGUNDA COMPARTILHADA',
                            hora: ['08:50', '09:40'],
                            chapa: '000200',
                            professor: 'OUTRA PROFESSORA',
                        },
                    ].flatMap((item) => [
                        {
                            CODTURMA: 'GPDIRM',
                            TURMA_GERENCIAL: 'Sim',
                            IDTURMADISC: item.oferta,
                            CODDISC: item.disc,
                            DISCIPLINA: item.nome,
                            ...(item.hora
                                ? { HORAINICIAL: item.hora[0], HORAFINAL: item.hora[1] }
                                : {}),
                            ...(item.chapa ? { CHAPA: item.chapa, NOME: item.professor } : {}),
                        },
                        ...['DIR07M1', 'DIR08M1'].map((codigo, indice) => ({
                            CODTURMA: codigo,
                            GERENCIADA: 'SIM',
                            CODTURMA_GERENCIAL: 'GPDIRM',
                            IDTURMADISC_GEREN: item.oferta,
                            IDTURMADISC: item.oferta * 10 + indice,
                            CODDISC: item.disc,
                            DISCIPLINA: item.nome,
                            ...(item.hora
                                ? { HORAINICIAL: item.hora[0], HORAFINAL: item.hora[1] }
                                : {}),
                            ...(item.chapa ? { CHAPA: item.chapa, NOME: item.professor } : {}),
                        })),
                    ]),
                ])
            );

            const turmas = await bd.query('SELECT id, codigo, nome, gerencial FROM turmas');
            return Object.fromEntries(turmas.rows.map((linha) => [linha.codigo, linha]));
        };

        it('cria uma turma por grupo, com o nome mostrando quem estuda junto', async () => {
            const turmas = await cenarioGrupo();
            const grupo = turmas['GPDIRM.DIR07M1.2'];

            expect(grupo).toBeDefined();
            expect(grupo.nome).toBe('GPDIRM (DIR07M1 | DIR08M1)');
            expect(grupo.gerencial).toBe(true);
        });

        it('lista as turmas do grupo com semestre e quantidade de aulas', async () => {
            const turmas = await cenarioGrupo();
            const matriz = await aulaService.montarMatriz(turmas['GPDIRM.DIR07M1.2'].id);

            expect(matriz.gerencial).toBe(true);
            expect(matriz.atendidas).toEqual([
                expect.objectContaining({ codigo: 'DIR07M1', semestre: 7, aulas: 2 }),
                expect.objectContaining({ codigo: 'DIR08M1', semestre: 8, aulas: 2 }),
            ]);
        });

        it('mostra em cada aula os semestres que a cursam', async () => {
            const turmas = await cenarioGrupo();
            const matriz = await aulaService.montarMatriz(turmas['GPDIRM.DIR07M1.2'].id);

            const celulas = Object.values(matriz.celulas).flat();
            expect(celulas).toHaveLength(2);

            celulas.forEach((aula) => {
                expect(aula.turmas_atendidas.map((turma) => turma.semestre).sort()).toEqual([7, 8]);
            });
        });

        it('leva a disciplina do grupo para a grade das duas turmas', async () => {
            const turmas = await cenarioGrupo();

            for (const codigo of ['DIR07M1', 'DIR08M1']) {
                const matriz = await aulaService.montarMatriz(turmas[codigo].id);
                const nomes = Object.values(matriz.celulas)
                    .flat()
                    .map((aula) => aula.disciplina_nome)
                    .sort();

                expect(nomes).toEqual(['Primeira Compartilhada', 'Segunda Compartilhada']);
                // Nenhuma delas e editavel ali: pertencem a turma gerencial.
                expect(
                    Object.values(matriz.celulas)
                        .flat()
                        .every((aula) => aula.propria === false)
                ).toBe(true);
            }
        });

        it('separa em turmas diferentes grupos com composicoes diferentes', async () => {
            // Mesma GPDIRM, dois conjuntos distintos de turmas: precisam virar
            // duas turmas gerenciais, senao a grade misturaria 1o e 8o semestre.
            await importacaoService.aplicar(
                montarCubo([
                    {
                        CODTURMA: 'GPDIRM',
                        TURMA_GERENCIAL: 'Sim',
                        IDTURMADISC: 910001,
                        CODDISC: '1.000911.040',
                        DISCIPLINA: 'DO OITAVO',
                    },
                    {
                        CODTURMA: 'DIR08M1',
                        GERENCIADA: 'SIM',
                        CODTURMA_GERENCIAL: 'GPDIRM',
                        IDTURMADISC_GEREN: 910001,
                        IDTURMADISC: 910011,
                        CODDISC: '1.000911.040',
                        DISCIPLINA: 'DO OITAVO',
                    },
                    {
                        CODTURMA: 'GPDIRM',
                        TURMA_GERENCIAL: 'Sim',
                        IDTURMADISC: 910002,
                        CODDISC: '1.000912.040',
                        DISCIPLINA: 'DO PRIMEIRO',
                        HORAINICIAL: '08:50',
                        HORAFINAL: '09:40',
                    },
                    {
                        CODTURMA: 'DIR01M1',
                        GERENCIADA: 'SIM',
                        CODTURMA_GERENCIAL: 'GPDIRM',
                        IDTURMADISC_GEREN: 910002,
                        IDTURMADISC: 910012,
                        CODDISC: '1.000912.040',
                        DISCIPLINA: 'DO PRIMEIRO',
                        HORAINICIAL: '08:50',
                        HORAFINAL: '09:40',
                    },
                ])
            );

            const grupos = await bd.query(
                `SELECT codigo, nome FROM turmas WHERE gerencial ORDER BY codigo`
            );

            expect(grupos.rows).toEqual([
                { codigo: 'GPDIRM.DIR01M1.1', nome: 'GPDIRM (DIR01M1)' },
                { codigo: 'GPDIRM.DIR08M1.1', nome: 'GPDIRM (DIR08M1)' },
            ]);
        });

        it('permite definir pelo painel quais turmas cursam a aula', async () => {
            const turmas = await cenarioGrupo();
            const aula = await bd.query(
                `SELECT a.id FROM aulas a
                   JOIN disciplinas d ON d.id = a.disciplina_id
                  WHERE d.nome = 'Primeira Compartilhada'`
            );

            await aulaService.atualizar(aula.rows[0].id, {
                turmasAtendidas: [turmas.DIR08M1.id],
            });

            const vinculos = await bd.query(
                `SELECT t.codigo FROM aula_turmas at
                   JOIN turmas t ON t.id = at.turma_id
                  WHERE at.aula_id = $1`,
                [aula.rows[0].id]
            );

            expect(vinculos.rows.map((linha) => linha.codigo)).toEqual(['DIR08M1']);
        });

        it('preserva o vinculo quando a edicao nao menciona as turmas', async () => {
            await cenarioGrupo();
            const aula = await bd.query(
                `SELECT a.id FROM aulas a
                   JOIN disciplinas d ON d.id = a.disciplina_id
                  WHERE d.nome = 'Primeira Compartilhada'`
            );

            await aulaService.atualizar(aula.rows[0].id, { observacao: 'ajuste qualquer' });

            const vinculos = await bd.query(
                'SELECT COUNT(*)::int AS total FROM aula_turmas WHERE aula_id = $1',
                [aula.rows[0].id]
            );
            expect(vinculos.rows[0].total).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    describe('alocacao de sala em lote', () => {
        const aulaService = require('../src/services/aulaService');

        /** Turma com quatro aulas em horarios distintos, todas sem local. */
        const turmaComAulas = async () => {
            await importacaoService.aplicar(
                montarCubo(
                    ['08:00', '08:50', '09:50', '10:40'].map((hora, indice) => ({
                        IDTURMADISC: 960001 + indice,
                        CODDISC: `1.00096${indice}.040`,
                        DISCIPLINA: `DISCIPLINA ${indice + 1}`,
                        HORAINICIAL: hora,
                        HORAFINAL:
                            hora === '08:00'
                                ? '08:50'
                                : hora === '08:50'
                                  ? '09:40'
                                  : hora === '09:50'
                                    ? '10:40'
                                    : '11:30',
                    }))
                )
            );

            const turma = await bd.query(
                "SELECT id, campus_id FROM turmas WHERE codigo = 'DIR01M1'"
            );
            return turma.rows[0];
        };

        it('aplica o mesmo local a todas as aulas da turma', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            const resultado = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                apenasSemLocal: true,
            });

            expect(resultado.alteradas).toBe(4);

            const semLocal = await contar(
                'SELECT COUNT(*)::int AS total FROM aulas WHERE local_id IS NULL'
            );
            expect(semLocal).toBe(0);
        });

        it('aplica somente a disciplina escolhida', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });
            const disciplina = await bd.query(
                "SELECT id FROM disciplinas WHERE nome = 'Disciplina 1'"
            );

            const resultado = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                disciplinas: [disciplina.rows[0].id],
            });

            expect(resultado.alteradas).toBe(1);
            expect(
                await contar('SELECT COUNT(*)::int AS total FROM aulas WHERE local_id IS NOT NULL')
            ).toBe(1);
        });

        it('aplica somente aos horarios marcados', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            const alvos = await bd.query(
                `SELECT DISTINCT h.id, TO_CHAR(h.hora_inicio, 'HH24:MI') AS inicio
                   FROM aulas a
                   JOIN horarios_turno h ON h.id = a.horario_turno_id
                  WHERE a.turma_id = $1
                  ORDER BY inicio
                  LIMIT 2`,
                [turma.id]
            );

            const resultado = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                horarios: alvos.rows.map((linha) => linha.id),
            });

            expect(resultado.total).toBe(2);
            expect(resultado.alteradas).toBe(2);

            const alocadas = await bd.query(
                `SELECT TO_CHAR(h.hora_inicio, 'HH24:MI') AS inicio
                   FROM aulas a
                   JOIN horarios_turno h ON h.id = a.horario_turno_id
                  WHERE a.turma_id = $1 AND a.local_id IS NOT NULL
                  ORDER BY inicio`,
                [turma.id]
            );

            expect(alocadas.rows.map((linha) => linha.inicio)).toEqual(
                alvos.rows.map((linha) => linha.inicio)
            );
        });

        it('lista vazia de horarios vale para a turma inteira', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            const resultado = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                horarios: [],
            });

            expect(resultado.alteradas).toBe(4);
        });

        it('combina horario com disciplina', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            const alvo = await bd.query(
                `SELECT a.horario_turno_id, a.disciplina_id
                   FROM aulas a
                   JOIN horarios_turno h ON h.id = a.horario_turno_id
                  WHERE a.turma_id = $1
                  ORDER BY h.hora_inicio
                  LIMIT 1`,
                [turma.id]
            );

            // Horario marcado + disciplina diferente da daquele horario: nada
            // corresponde, e nada deve ser alterado.
            const outra = await bd.query(`SELECT id FROM disciplinas WHERE id <> $1 LIMIT 1`, [
                alvo.rows[0].disciplina_id,
            ]);

            const vazio = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                horarios: [alvo.rows[0].horario_turno_id],
                disciplinas: [outra.rows[0].id],
            });

            expect(vazio.total).toBe(0);
            expect(vazio.alteradas).toBe(0);
        });

        it('aplica somente aos dias da semana marcados', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            // A planilha padrao poe tudo na segunda; aqui move duas aulas para
            // a terca, para que o recorte por dia tenha o que separar.
            const mover = await bd.query(
                'SELECT id FROM aulas WHERE turma_id = $1 ORDER BY id LIMIT 2',
                [turma.id]
            );
            await bd.query('UPDATE aulas SET dia_semana = 2 WHERE id = ANY($1::int[])', [
                mover.rows.map((linha) => linha.id),
            ]);

            const resultado = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                dias: [2],
            });

            expect(resultado.total).toBe(2);
            expect(resultado.alteradas).toBe(2);

            const porDia = await bd.query(
                `SELECT dia_semana, COUNT(*)::int AS total
                   FROM aulas WHERE turma_id = $1 AND local_id IS NOT NULL
                  GROUP BY dia_semana`,
                [turma.id]
            );
            expect(porDia.rows).toEqual([{ dia_semana: 2, total: 2 }]);
        });

        it('combina disciplina, dia e horario no mesmo recorte', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            const alvo = await bd.query(
                `SELECT a.id, a.disciplina_id, a.dia_semana, a.horario_turno_id
                   FROM aulas a WHERE a.turma_id = $1 ORDER BY a.id LIMIT 1`,
                [turma.id]
            );
            const aula = alvo.rows[0];

            const resultado = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                disciplinas: [aula.disciplina_id],
                dias: [aula.dia_semana],
                horarios: [aula.horario_turno_id],
            });

            expect(resultado.total).toBe(1);

            const alocadas = await bd.query(
                'SELECT id FROM aulas WHERE turma_id = $1 AND local_id IS NOT NULL',
                [turma.id]
            );
            expect(alocadas.rows.map((linha) => linha.id)).toEqual([aula.id]);
        });

        it('limpa a alocacao quando nenhum local e escolhido', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            await aulaService.definirLocalEmLote(turma.id, { localId: local.id });
            const limpeza = await aulaService.definirLocalEmLote(turma.id, { localId: null });

            expect(limpeza.alteradas).toBe(4);
            expect(
                await contar('SELECT COUNT(*)::int AS total FROM aulas WHERE local_id IS NULL')
            ).toBe(4);
        });

        it('aloca o lote inteiro mesmo com a sala ja ocupada em um dos horarios', async () => {
            const turma = await turmaComAulas();
            const local = await bd.criarLocal({ campusId: turma.campus_id });

            // Outra turma ja ocupa esta sala num dos horarios.
            const outra = await bd.criarTurma({ campusId: turma.campus_id });
            const horario = await bd.horarioDoTurno('matutino', 2);
            await bd.criarAula({
                turmaId: outra.id,
                localId: local.id,
                diaSemana: 1,
                horarioTurnoId: horario.id,
            });

            const resultado = await aulaService.definirLocalEmLote(turma.id, {
                localId: local.id,
                apenasSemLocal: true,
            });

            // Choque de sala deixou de recusar: o recorte inteiro recebe o local.
            expect(resultado.alteradas).toBe(4);

            const semLocal = await contar(
                'SELECT COUNT(*)::int AS total FROM aulas WHERE local_id IS NULL AND turma_id = $1',
                [turma.id]
            );
            expect(semLocal).toBe(0);
        });

        it('nao altera aula que a turma apenas assiste', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            const atendida = await bd.query(
                "SELECT id, campus_id FROM turmas WHERE codigo = 'DIR08M1'"
            );
            const local = await bd.criarLocal({ campusId: atendida.rows[0].campus_id });

            const resultado = await aulaService.definirLocalEmLote(atendida.rows[0].id, {
                localId: local.id,
            });

            // A aula pertence a turma gerencial: alterar aqui mudaria a
            // alocacao de todas as turmas do grupo.
            expect(resultado.total).toBe(0);
            expect(
                await contar('SELECT COUNT(*)::int AS total FROM aulas WHERE local_id IS NOT NULL')
            ).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    describe('listagem de turmas', () => {
        const turmaService = require('../src/services/turmaService');

        // Escopo global: `turmaService.listar` nega tudo para usuario ausente.
        const admin = { perfil: 'admin', cursosIds: [], campusIds: [] };

        it('lista por padrao so as turmas em que se monta grade', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            const { itens, integradasOcultas } = await turmaService.listar(admin, {});
            const codigos = itens.map((turma) => turma.codigo).sort();

            // DIR07M1 e DIR08M1 recebem as disciplinas da gerencial e nao tem
            // grade propria para montar.
            expect(codigos).toEqual(['GPDIRM.DIR07M1.2']);
            expect(integradasOcultas).toBe(2);
        });

        it('mostra todas quando o operador pede', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            const { itens, integradasOcultas } = await turmaService.listar(admin, {
                exibicao: 'todas',
            });

            expect(itens.map((turma) => turma.codigo).sort()).toEqual([
                'DIR07M1',
                'DIR08M1',
                'GPDIRM.DIR07M1.2',
            ]);
            expect(integradasOcultas).toBe(0);
        });

        it('mantem na lista a turma integrada que tem aula propria', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            const turma = await bd.query("SELECT id FROM turmas WHERE codigo = 'DIR08M1'");
            const disciplina = await bd.criarDisciplina();
            const horario = await bd.horarioDoTurno('matutino', 3);

            await bd.criarAula({
                turmaId: turma.rows[0].id,
                disciplinaId: disciplina.id,
                diaSemana: 3,
                horarioTurnoId: horario.id,
            });

            const { itens } = await turmaService.listar(admin, {});

            // Ela e atendida pela gerencial, mas tambem tem grade propria:
            // esconde-la deixaria essa aula inacessivel.
            expect(itens.map((turma) => turma.codigo).sort()).toEqual([
                'DIR08M1',
                'GPDIRM.DIR07M1.2',
            ]);
        });

        it('traz o grupo de turmas atendidas pela gerencial', async () => {
            await importacaoService.aplicar(planilhaCompartilhada());

            const { itens } = await turmaService.listar(admin, {});
            const gerencial = itens.find((turma) => turma.gerencial);

            expect(gerencial.grupo.map((item) => item.codigo)).toEqual(['DIR07M1', 'DIR08M1']);
            expect(gerencial.grupo.map((item) => item.semestre)).toEqual([7, 8]);
        });
    });

    // -----------------------------------------------------------------------
    describe('rotas do painel', () => {
        let app;
        let agente;
        let admin;

        beforeEach(async () => {
            app = criarApp();
            agente = criarAgente(app);
            admin = await bd.criarUsuario({ perfil: 'admin' });
            await login(agente, admin.email, admin.senha);
        });

        it('exibe a tela de importacao para o administrador', async () => {
            const resposta = await agente.get('/admin/importacao');

            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain('Enviar planilha');
        });

        it('recusa o envio sem token CSRF valido', async () => {
            const resposta = await agente
                .post('/admin/importacao')
                .field('_csrf', 'token-invalido')
                .attach('arquivo', planilhaCompartilhada(), 'cubo.xlsx');

            expect(resposta.status).toBe(403);
            expect(await contar('SELECT COUNT(*)::int AS total FROM turmas')).toBe(0);
        });

        it('simula a carga e nao grava nada ao receber a planilha', async () => {
            const token = await tokenCsrf(agente);

            const resposta = await agente
                .post('/admin/importacao')
                .field('_csrf', token)
                .attach('arquivo', planilhaCompartilhada(), 'cubo.xlsx');

            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain('Nada foi gravado ainda');
            expect(await contar('SELECT COUNT(*)::int AS total FROM turmas')).toBe(0);
        });

        it('grava somente apos a confirmacao', async () => {
            const token = await tokenCsrf(agente);

            const previa = await agente
                .post('/admin/importacao')
                .field('_csrf', token)
                .attach('arquivo', planilhaCompartilhada(), 'cubo.xlsx');

            const acao = /action="([^"]*\/aplicar)"/.exec(previa.text);
            expect(acao).not.toBeNull();

            const resposta = await agente.post(acao[1]).type('form').send({ _csrf: token });

            expect(resposta.status).toBe(200);
            expect(resposta.text).toContain('Importação concluída');
            expect(await contar('SELECT COUNT(*)::int AS total FROM turmas')).toBe(3);
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas')).toBe(1);
        });

        it('recusa arquivo que nao seja .xlsx', async () => {
            const token = await tokenCsrf(agente);

            const resposta = await agente
                .post('/admin/importacao')
                .field('_csrf', token)
                .attach('arquivo', Buffer.from('nao e planilha'), 'dados.csv');

            expect(resposta.status).toBe(422);
            expect(resposta.text).toContain('.xlsx');
        });

        it('nega acesso a coordenador e a nap', async () => {
            for (const perfil of ['coordenador', 'nap']) {
                const usuario = await bd.criarUsuario({ perfil });
                const outro = criarAgente(app);
                await login(outro, usuario.email, usuario.senha);

                const resposta = await outro.get('/admin/importacao');
                expect(resposta.status).toBe(403);
            }
        });
    });

    // -----------------------------------------------------------------------
    describe('atomicidade', () => {
        it('nao deixa carga pela metade quando uma linha e invalida', async () => {
            // Coluna obrigatoria ausente: a planilha inteira e recusada antes de
            // qualquer gravacao.
            const semColuna = COLUNAS_CUBO.filter((coluna) => coluna !== 'CODTURMA');
            const arquivo = montarXlsx(semColuna, [semColuna.map(() => 'x')]);

            await expect(importacaoService.aplicar(arquivo)).rejects.toThrow(/formato esperado/i);

            expect(await contar('SELECT COUNT(*)::int AS total FROM turmas')).toBe(0);
            expect(await contar('SELECT COUNT(*)::int AS total FROM disciplinas')).toBe(0);
        });

        it('ignora linhas incompletas e avisa, sem derrubar a carga', async () => {
            const relatorio = await importacaoService.aplicar(
                montarCubo([
                    { IDTURMADISC: 900001 },
                    { IDTURMADISC: 900002, SEMANA: null, HORAINICIAL: null },
                ])
            );

            expect(relatorio.totais.linhasIgnoradas).toBe(1);
            expect(relatorio.avisos.some((aviso) => aviso.tipo === 'linha_invalida')).toBe(true);
            expect(await contar('SELECT COUNT(*)::int AS total FROM aulas')).toBe(1);
        });
    });
});
