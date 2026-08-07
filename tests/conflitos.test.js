/**
 * Regras de conflito da grade horaria (`services/conflitoService` e
 * `services/aulaService`).
 *
 * O caso critico coberto aqui e o conflito de professor entre turnos DIFERENTES
 * que ocupam o mesmo tempo de relogio: o 5o horario do Matutino (10:40-11:30) e
 * o 5o do Integral (10:40-11:30) sao registros distintos em `horarios_turno`.
 * Comparar `horario_turno_id` deixaria o choque passar; a comparacao correta e
 * pela faixa real (`hora_inicio`/`hora_fim`).
 */
const bd = require('./helpers/db');
const aulaService = require('../src/services/aulaService');
const conflitoService = require('../src/services/conflitoService');
const db = require('../src/config/db');
const { ErroConflito, ErroValidacao } = require('../src/utils/erros');

/** Segunda a sabado, para deixar os testes legiveis. */
const SEGUNDA = 1;
const TERCA = 2;
const QUARTA = 3;
const SABADO = 6;

/** Tipos dos conflitos devolvidos, na ordem em que apareceram. */
const tipos = (conflitos) => conflitos.map((item) => item.tipo);

/** Concatena as mensagens para asserts de conteudo. */
const textos = (conflitos) => conflitos.map((item) => item.mensagem).join(' | ');

/**
 * Executa `acao` e devolve o ErroConflito lancado.
 * @param {() => Promise<any>} acao
 * @returns {Promise<ErroConflito>}
 */
const capturarConflito = async (acao) => {
    try {
        await acao();
    } catch (erro) {
        return erro;
    }
    throw new Error('Esperava um ErroConflito, mas a operação foi concluída.');
};

/** Cenario padrao: campus, curso, turma matutina, disciplina e professor. */
const cenarioBasico = async (opcoes = {}) => {
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
        turnoSlug: opcoes.turnoSlug || 'matutino',
    });
    const disciplina = await bd.criarDisciplina({ nome: 'Cálculo I', cursoId: curso.id });
    const professor = await bd.criarProfessor({ nome: 'João Silva' });
    const local = await bd.criarLocal({ campusId: campus.id, nome: '201 C', tipo: 'sala' });

    return { campus, curso, turma, disciplina, professor, local };
};

beforeEach(async () => {
    await bd.limparDados();
});

afterAll(async () => {
    await bd.encerrar();
});

// ---------------------------------------------------------------------------
// Regra 1 - turma
// ---------------------------------------------------------------------------
describe('conflito de turma', () => {
    test('a mesma turma nao pode ter duas aulas no mesmo dia e horario', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });
        const horario = await bd.horarioDoTurno('matutino', 2);

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: outra.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        );

        expect(erro).toBeInstanceOf(ErroConflito);
        expect(tipos(erro.detalhes)).toContain('turma');
        expect(erro.message).toBe(
            'A turma ADS02 já possui aula na segunda-feira, das 08:00 às 08:50 (Cálculo I).'
        );
    });

    test('a mesma turma pode ter aulas em horarios diferentes do mesmo dia', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });
        const primeiro = await bd.horarioDoTurno('matutino', 1);
        const segundo = await bd.horarioDoTurno('matutino', 2);

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: primeiro.id,
        });

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: outra.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: segundo.id,
        });

        expect(aula.id).toBeGreaterThan(0);
    });

    test('o indice unico do banco continua sendo a rede de seguranca', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        await bd.criarAula({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        await expect(
            bd.criarAula({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        ).rejects.toMatchObject({ code: '23505' });
    });
});

// ---------------------------------------------------------------------------
// Regra 2 - professor (caso critico)
// ---------------------------------------------------------------------------
describe('conflito de professor', () => {
    test('o 5o horario do Matutino e o 5o do Integral sao registros distintos com a mesma faixa', async () => {
        const matutino = await bd.horarioDoTurno('matutino', 5);
        const integral = await bd.horarioDoTurno('integral', 5);

        expect(matutino.id).not.toBe(integral.id);
        expect(matutino.turno_id).not.toBe(integral.turno_id);
        expect(String(matutino.hora_inicio)).toBe('10:40:00');
        expect(String(matutino.hora_fim)).toBe('11:30:00');
        expect(String(integral.hora_inicio)).toBe(String(matutino.hora_inicio));
        expect(String(integral.hora_fim)).toBe(String(matutino.hora_fim));
    });

    test('acusa conflito entre cursos e campus diferentes com horarios de turnos diferentes', async () => {
        const campusA = await bd.criarCampus({ nome: 'Águas Claras', sigla: 'AC' });
        const campusB = await bd.criarCampus({ nome: 'Asa Sul', sigla: 'AS' });

        const cursoA = await bd.criarCurso({
            nome: 'Análise e Desenvolvimento',
            campusIds: [campusA.id],
        });
        const cursoB = await bd.criarCurso({ nome: 'Enfermagem', campusIds: [campusB.id] });

        const turmaA = await bd.criarTurma({
            nome: 'ADS 2º semestre',
            codigo: 'ADS02',
            cursoId: cursoA.id,
            campusId: campusA.id,
            turnoSlug: 'matutino',
        });
        const turmaB = await bd.criarTurma({
            nome: 'Enfermagem 3º semestre',
            codigo: 'ENF03',
            cursoId: cursoB.id,
            campusId: campusB.id,
            turnoSlug: 'integral',
        });

        const professor = await bd.criarProfessor({ nome: 'João Silva' });
        const calculo = await bd.criarDisciplina({ nome: 'Cálculo I' });
        const anatomia = await bd.criarDisciplina({ nome: 'Anatomia' });

        const matutino5 = await bd.horarioDoTurno('matutino', 5);
        const integral5 = await bd.horarioDoTurno('integral', 5);

        await aulaService.criar({
            turmaId: turmaA.id,
            disciplinaId: calculo.id,
            professorId: professor.id,
            diaSemana: TERCA,
            horarioTurnoId: matutino5.id,
        });

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turmaB.id,
                disciplinaId: anatomia.id,
                professorId: professor.id,
                diaSemana: TERCA,
                horarioTurnoId: integral5.id,
            })
        );

        expect(erro).toBeInstanceOf(ErroConflito);
        expect(tipos(erro.detalhes)).toEqual(['professor']);
        expect(erro.detalhes[0].mensagem).toBe(
            'O professor João Silva já possui aula na terça-feira, das 10:40 às 11:30, na turma ADS02.'
        );
        expect(erro.detalhes[0].aulaId).toBeGreaterThan(0);
    });

    test('a mensagem traz nome do professor, dia por extenso e faixa de horario', async () => {
        const { turma, disciplina, professor } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: QUARTA,
            horarioTurnoId: horario.id,
        });

        const conflitos = await aulaService.prevendoConflitos({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: QUARTA,
            horarioTurnoId: horario.id,
        });

        const mensagem = textos(conflitos);
        expect(mensagem).toContain('João Silva');
        expect(mensagem).toContain('quarta-feira');
        expect(mensagem).toContain('07:10 às 08:00');
    });

    test('nao acusa conflito quando as faixas nao se sobrepoem', async () => {
        const campus = await bd.criarCampus({ nome: 'Águas Claras' });
        const turmaA = await bd.criarTurma({
            codigo: 'ADS02',
            campusId: campus.id,
            turnoSlug: 'matutino',
        });
        const turmaB = await bd.criarTurma({
            codigo: 'ENF03',
            campusId: campus.id,
            turnoSlug: 'integral',
        });
        const professor = await bd.criarProfessor({ nome: 'João Silva' });
        const disciplina = await bd.criarDisciplina();

        const matutino1 = await bd.horarioDoTurno('matutino', 1); // 07:10 - 08:00
        const integral6 = await bd.horarioDoTurno('integral', 6); // 13:00 - 13:50

        await aulaService.criar({
            turmaId: turmaA.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: TERCA,
            horarioTurnoId: matutino1.id,
        });

        const aula = await aulaService.criar({
            turmaId: turmaB.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: TERCA,
            horarioTurnoId: integral6.id,
        });

        expect(aula.professor_id).toBe(professor.id);
    });

    test('nao acusa conflito quando os dias sao diferentes', async () => {
        const { turma, disciplina, professor } = await cenarioBasico();
        const outraTurma = await bd.criarTurma({ codigo: 'ADS03', turnoSlug: 'matutino' });
        const horario = await bd.horarioDoTurno('matutino', 3);

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        const aula = await aulaService.criar({
            turmaId: outraTurma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: TERCA,
            horarioTurnoId: horario.id,
        });

        expect(aula.dia_semana).toBe(TERCA);
    });

    describe('aula EAD nao disputa a agenda do professor', () => {
        /**
         * Mesmo professor, mesmo dia e mesma faixa, em duas turmas — o cenario
         * que normalmente acusa conflito.
         */
        const mesmoTempo = async () => {
            const { turma, disciplina, professor } = await cenarioBasico();
            const outraTurma = await bd.criarTurma({ codigo: 'ADS03', turnoSlug: 'matutino' });
            const horario = await bd.horarioDoTurno('matutino', 3);
            return { turma, outraTurma, disciplina, professor, horario };
        };

        test('a EAD entra quando o professor ja tem presencial no mesmo horario', async () => {
            const { turma, outraTurma, disciplina, professor, horario } = await mesmoTempo();

            await aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
                modalidade: 'presencial',
            });

            const ead = await aulaService.criar({
                turmaId: outraTurma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
                modalidade: 'ead',
            });

            expect(ead.modalidade).toBe('ead');
            expect(ead.professor_id).toBe(professor.id);
        });

        test('a presencial entra quando o professor ja tem EAD no mesmo horario', async () => {
            const { turma, outraTurma, disciplina, professor, horario } = await mesmoTempo();

            await aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
                modalidade: 'ead',
            });

            const presencial = await aulaService.criar({
                turmaId: outraTurma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
                modalidade: 'presencial',
            });

            expect(presencial.modalidade).toBe('presencial');
        });

        test('a pre-visualizacao tambem nao acusa nada', async () => {
            const { turma, outraTurma, disciplina, professor, horario } = await mesmoTempo();

            await aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            });

            const conflitos = await aulaService.prevendoConflitos({
                turmaId: outraTurma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
                modalidade: 'ead',
            });

            expect(tipos(conflitos)).not.toContain('professor');
        });

        test('hibrido continua disputando: tem encontro presencial', async () => {
            const { turma, outraTurma, disciplina, professor, horario } = await mesmoTempo();

            await aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
                modalidade: 'presencial',
            });

            const erro = await capturarConflito(() =>
                aulaService.criar({
                    turmaId: outraTurma.id,
                    disciplinaId: disciplina.id,
                    professorId: professor.id,
                    diaSemana: SEGUNDA,
                    horarioTurnoId: horario.id,
                    modalidade: 'hibrido',
                })
            );

            expect(tipos(erro.detalhes)).toContain('professor');
        });
    });
});

// ---------------------------------------------------------------------------
// Regra 3 - local
// ---------------------------------------------------------------------------
describe('conflito de local', () => {
    /**
     * Duas turmas de turnos diferentes na mesma sala, no mesmo tempo de relogio
     * (matutino 08:00 e integral 08:00 sao registros distintos do mesmo horario).
     */
    const salaDisputada = async () => {
        const campus = await bd.criarCampus({ nome: 'Águas Claras' });
        const local = await bd.criarLocal({ campusId: campus.id, nome: '201 C', tipo: 'sala' });
        const turmaA = await bd.criarTurma({
            codigo: 'ADS02',
            campusId: campus.id,
            turnoSlug: 'matutino',
        });
        const turmaB = await bd.criarTurma({
            codigo: 'ENF03',
            campusId: campus.id,
            turnoSlug: 'integral',
        });
        const disciplina = await bd.criarDisciplina();

        const matutino2 = await bd.horarioDoTurno('matutino', 2); // 08:00 - 08:50
        const integral2 = await bd.horarioDoTurno('integral', 2); // 08:00 - 08:50

        await aulaService.criar({
            turmaId: turmaB.id,
            disciplinaId: disciplina.id,
            localId: local.id,
            diaSemana: QUARTA,
            horarioTurnoId: integral2.id,
        });

        return { local, turmaA, disciplina, matutino2 };
    };

    test('sala ja ocupada nao impede gravar a aula', async () => {
        const { local, turmaA, disciplina, matutino2 } = await salaDisputada();

        // A grade vem do TOTVS sem sala e o NAP aloca depois; travar aqui
        // deixaria a aula sem sala sem saida pelo painel.
        const aula = await aulaService.criar({
            turmaId: turmaA.id,
            disciplinaId: disciplina.id,
            localId: local.id,
            diaSemana: QUARTA,
            horarioTurnoId: matutino2.id,
        });

        expect(aula.local_id).toBe(local.id);
    });

    test('a ocupacao da sala continua sendo detectada e informada', async () => {
        const { local, turmaA, disciplina, matutino2 } = await salaDisputada();

        // Deixou de barrar, mas nao deixou de avisar: a pre-visualizacao do
        // formulario mostra o choque para o operador decidir.
        const conflitos = await aulaService.prevendoConflitos({
            turmaId: turmaA.id,
            disciplinaId: disciplina.id,
            localId: local.id,
            diaSemana: QUARTA,
            horarioTurnoId: matutino2.id,
        });

        expect(tipos(conflitos)).toEqual(['local']);
        expect(conflitos[0].mensagem).toBe(
            'O local 201 C já está ocupado na quarta-feira, das 08:00 às 08:50, pela turma ENF03.'
        );
    });

    test('sala de outro campus continua recusada', async () => {
        const { turmaA, disciplina, matutino2 } = await salaDisputada();
        const outroCampus = await bd.criarCampus({ nome: 'Asa Sul' });
        const salaDeLa = await bd.criarLocal({ campusId: outroCampus.id, nome: 'B12' });

        // Erro de cadastro, nao disputa de agenda: segue impedindo.
        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turmaA.id,
                disciplinaId: disciplina.id,
                localId: salaDeLa.id,
                diaSemana: QUARTA,
                horarioTurnoId: matutino2.id,
            })
        );

        expect(tipos(erro.detalhes)).toEqual(['campus']);
    });

    test('local do tipo virtual aceita varias turmas ao mesmo tempo', async () => {
        const campus = await bd.criarCampus({ nome: 'Águas Claras' });
        const virtual = await bd.criarLocal({
            campusId: campus.id,
            nome: 'Ambiente EAD',
            tipo: 'virtual',
            capacidade: null,
        });
        const turmaA = await bd.criarTurma({
            codigo: 'ADS02',
            campusId: campus.id,
            turnoSlug: 'matutino',
        });
        const turmaB = await bd.criarTurma({
            codigo: 'ENF03',
            campusId: campus.id,
            turnoSlug: 'matutino',
        });
        const disciplina = await bd.criarDisciplina();
        const horario = await bd.horarioDoTurno('matutino', 1);

        await aulaService.criar({
            turmaId: turmaA.id,
            disciplinaId: disciplina.id,
            localId: virtual.id,
            diaSemana: QUARTA,
            horarioTurnoId: horario.id,
            modalidade: 'ead',
        });

        const segunda = await aulaService.criar({
            turmaId: turmaB.id,
            disciplinaId: disciplina.id,
            localId: virtual.id,
            diaSemana: QUARTA,
            horarioTurnoId: horario.id,
            modalidade: 'ead',
        });

        expect(segunda.local_id).toBe(virtual.id);
        expect(segunda.modalidade).toBe('ead');
    });
});

// ---------------------------------------------------------------------------
// Regra 4 - turno do horario
// ---------------------------------------------------------------------------
describe('turno do horario', () => {
    test('recusa horario que nao pertence ao turno da turma', async () => {
        const { turma, disciplina } = await cenarioBasico({ turnoSlug: 'noturno' });
        const horarioMatutino = await bd.horarioDoTurno('matutino', 1);

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horarioMatutino.id,
            })
        );

        expect(tipos(erro.detalhes)).toEqual(['turno']);
        expect(erro.detalhes[0].mensagem).toBe(
            'O horário selecionado pertence ao turno Matutino, mas a turma ADS02 é do turno Noturno.'
        );
    });

    test('aceita horario do proprio turno', async () => {
        const { turma, disciplina } = await cenarioBasico({ turnoSlug: 'noturno' });
        const horario = await bd.horarioDoTurno('noturno', 2); // 19:00 - 19:50

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        expect(aula.horario_turno_id).toBe(horario.id);
        expect(String(aula.hora_inicio)).toBe('19:00:00');
    });
});

// ---------------------------------------------------------------------------
// Regra 5 - campus do local
// ---------------------------------------------------------------------------
describe('campus do local', () => {
    test('recusa local de outro campus', async () => {
        const campusA = await bd.criarCampus({ nome: 'Águas Claras', sigla: 'AC' });
        const campusB = await bd.criarCampus({ nome: 'Asa Sul', sigla: 'AS' });
        const turma = await bd.criarTurma({
            codigo: 'ADS02',
            campusId: campusA.id,
            turnoSlug: 'matutino',
        });
        const disciplina = await bd.criarDisciplina();
        const local = await bd.criarLocal({
            campusId: campusB.id,
            nome: 'Lab 01',
            tipo: 'laboratorio',
        });
        const horario = await bd.horarioDoTurno('matutino', 1);

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                localId: local.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        );

        expect(tipos(erro.detalhes)).toEqual(['campus']);
        expect(erro.detalhes[0].mensagem).toBe(
            'O local Lab 01 pertence ao campus Asa Sul, mas a turma ADS02 é do campus Águas Claras.'
        );
    });

    test('local virtual de outro campus e excecao', async () => {
        const campusA = await bd.criarCampus({ nome: 'Águas Claras', sigla: 'AC' });
        const campusB = await bd.criarCampus({ nome: 'Asa Sul', sigla: 'AS' });
        const turma = await bd.criarTurma({
            codigo: 'ADS02',
            campusId: campusA.id,
            turnoSlug: 'matutino',
        });
        const disciplina = await bd.criarDisciplina();
        const virtual = await bd.criarLocal({ campusId: campusB.id, nome: 'AVA', tipo: 'virtual' });
        const horario = await bd.horarioDoTurno('matutino', 1);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            localId: virtual.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
            modalidade: 'ead',
        });

        expect(aula.local_tipo).toBe('virtual');
    });
});

// ---------------------------------------------------------------------------
// Regra 6 - registros inativos
// ---------------------------------------------------------------------------
describe('registros inativos', () => {
    test('bloqueia professor inativo dizendo qual registro esta inativo', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const professor = await bd.criarProfessor({ nome: 'Maria Souza', ativo: false });
        const horario = await bd.horarioDoTurno('matutino', 1);

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        );

        expect(tipos(erro.detalhes)).toEqual(['inativo']);
        expect(erro.detalhes[0].mensagem).toBe(
            'Não é possível usar o professor Maria Souza porque ele está inativo.'
        );
    });

    test('bloqueia disciplina inativa', async () => {
        const { turma } = await cenarioBasico();
        const disciplina = await bd.criarDisciplina({ nome: 'Química', ativo: false });
        const horario = await bd.horarioDoTurno('matutino', 1);

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        );

        expect(textos(erro.detalhes)).toContain('a disciplina Química porque ela está inativo');
    });

    test('bloqueia local inativo', async () => {
        const { turma, disciplina, campus } = await cenarioBasico();
        const local = await bd.criarLocal({ campusId: campus.id, nome: 'Lab 02', ativo: false });
        const horario = await bd.horarioDoTurno('matutino', 1);

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                localId: local.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        );

        expect(textos(erro.detalhes)).toContain('o local Lab 02');
    });

    test('bloqueia turma inativa', async () => {
        const campus = await bd.criarCampus({ nome: 'Águas Claras' });
        const turma = await bd.criarTurma({
            codigo: 'ADS09',
            campusId: campus.id,
            turnoSlug: 'matutino',
            ativo: false,
        });
        const disciplina = await bd.criarDisciplina();
        const horario = await bd.horarioDoTurno('matutino', 1);

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        );

        expect(textos(erro.detalhes)).toContain('a turma ADS09 porque ela está inativo');
    });

    test('bloqueia curso inativo', async () => {
        const campus = await bd.criarCampus({ nome: 'Águas Claras' });
        const curso = await bd.criarCurso({
            nome: 'Curso Encerrado',
            ativo: false,
            campusIds: [campus.id],
        });
        const turma = await bd.criarTurma({
            codigo: 'ADS10',
            campusId: campus.id,
            cursoId: curso.id,
            turnoSlug: 'matutino',
        });
        const disciplina = await bd.criarDisciplina();
        const horario = await bd.horarioDoTurno('matutino', 1);

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            })
        );

        expect(textos(erro.detalhes)).toContain('o curso Curso Encerrado');
    });

    test('bloqueia horario inativo', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 4);

        await bd.query('UPDATE horarios_turno SET ativo = FALSE WHERE id = $1', [horario.id]);

        try {
            const erro = await capturarConflito(() =>
                aulaService.criar({
                    turmaId: turma.id,
                    disciplinaId: disciplina.id,
                    diaSemana: SEGUNDA,
                    horarioTurnoId: horario.id,
                })
            );

            expect(textos(erro.detalhes)).toContain('o horário 4º horário (09:50 às 10:40)');
        } finally {
            await bd.query('UPDATE horarios_turno SET ativo = TRUE WHERE id = $1', [horario.id]);
        }
    });

    test('acumula todos os problemas em vez de parar no primeiro', async () => {
        const campusA = await bd.criarCampus({ nome: 'Águas Claras', sigla: 'AC' });
        const campusB = await bd.criarCampus({ nome: 'Asa Sul', sigla: 'AS' });
        const turma = await bd.criarTurma({
            codigo: 'ADS02',
            campusId: campusA.id,
            turnoSlug: 'noturno',
        });
        const disciplina = await bd.criarDisciplina({ nome: 'Química', ativo: false });
        const professor = await bd.criarProfessor({ nome: 'Maria Souza', ativo: false });
        const local = await bd.criarLocal({ campusId: campusB.id, nome: 'Lab 01' });
        const horarioMatutino = await bd.horarioDoTurno('matutino', 1);

        const conflitos = await aulaService.prevendoConflitos({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            localId: local.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horarioMatutino.id,
        });

        expect(conflitos.length).toBeGreaterThanOrEqual(4);
        expect(tipos(conflitos)).toEqual(expect.arrayContaining(['inativo', 'turno', 'campus']));
        expect(tipos(conflitos).filter((tipo) => tipo === 'inativo').length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Regra 7 - dia da semana
// ---------------------------------------------------------------------------
describe('dia da semana', () => {
    test('aceita sabado (dia 6)', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SABADO,
            horarioTurnoId: horario.id,
        });

        expect(aula.dia_semana).toBe(SABADO);
    });

    test('recusa domingo (dia 7)', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        await expect(
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: 7,
                horarioTurnoId: horario.id,
            })
        ).rejects.toBeInstanceOf(ErroValidacao);
    });

    test('a mensagem de conflito usa a preposicao correta no sabado', async () => {
        const { turma, disciplina, professor } = await cenarioBasico();
        const outraTurma = await bd.criarTurma({ codigo: 'ADS03', turnoSlug: 'matutino' });
        const horario = await bd.horarioDoTurno('matutino', 1);

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: SABADO,
            horarioTurnoId: horario.id,
        });

        const conflitos = await aulaService.prevendoConflitos({
            turmaId: outraTurma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: SABADO,
            horarioTurnoId: horario.id,
        });

        expect(textos(conflitos)).toContain('no sábado');
    });
});

// ---------------------------------------------------------------------------
// Aulas sem horario (pendencias)
// ---------------------------------------------------------------------------
describe('aulas sem horario', () => {
    test('sao aceitas e aparecem em pendentes na matriz', async () => {
        const { turma, disciplina } = await cenarioBasico();

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: '',
        });

        expect(aula.horario_turno_id).toBeNull();

        const matriz = await aulaService.montarMatriz(turma.id);
        expect(matriz.pendentes).toHaveLength(1);
        expect(matriz.pendentes[0].id).toBe(aula.id);
        expect(Object.keys(matriz.celulas)).toHaveLength(0);
    });

    test('duas aulas sem horario no mesmo dia convivem', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: null,
        });
        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: outra.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: null,
        });

        const pendentes = await aulaService.listarPendencias({ turmaId: turma.id });
        expect(pendentes).toHaveLength(2);
    });

    test('mas o campus do local continua sendo validado sem horario', async () => {
        const campusA = await bd.criarCampus({ nome: 'Águas Claras' });
        const campusB = await bd.criarCampus({ nome: 'Asa Sul' });
        const turma = await bd.criarTurma({
            codigo: 'ADS02',
            campusId: campusA.id,
            turnoSlug: 'matutino',
        });
        const disciplina = await bd.criarDisciplina();
        const local = await bd.criarLocal({ campusId: campusB.id, nome: 'Lab 01' });

        const erro = await capturarConflito(() =>
            aulaService.criar({
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                localId: local.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: null,
            })
        );

        expect(tipos(erro.detalhes)).toEqual(['campus']);
    });
});

// ---------------------------------------------------------------------------
// Matriz da grade
// ---------------------------------------------------------------------------
describe('montarMatriz', () => {
    test('devolve turma, horarios do turno, dias, celulas e totais', async () => {
        const { turma, disciplina, professor, local } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 2);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            localId: local.id,
            diaSemana: TERCA,
            horarioTurnoId: horario.id,
        });
        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: QUARTA,
            horarioTurnoId: null,
        });

        const matriz = await aulaService.montarMatriz(turma.id);

        expect(matriz.turma).toMatchObject({
            id: turma.id,
            codigo: 'ADS02',
            curso_nome: 'Análise e Desenvolvimento',
            campus_nome: 'Águas Claras',
            turno_nome: 'Matutino',
        });
        expect(matriz.turma.periodo_codigo).toEqual(expect.any(String));

        expect(matriz.horarios).toHaveLength(5);
        expect(matriz.horarios[0].faixa).toBe('07:10 às 08:00');

        expect(matriz.dias).toHaveLength(6);
        expect(matriz.dias[5]).toEqual({ valor: 6, nome: 'Sábado', curto: 'Sábado', sigla: 'SAB' });

        // Cada celula e uma lista: turma gerencial pode ofertar disciplinas em
        // paralelo no mesmo dia e horario. Em turma regular sempre ha uma so.
        const celula = matriz.celulas[`${TERCA}:${horario.id}`];
        expect(celula).toHaveLength(1);
        expect(celula[0]).toMatchObject({
            id: aula.id,
            disciplina_nome: 'Cálculo I',
            professor_nome: 'João Silva',
            local_nome: '201 C',
            local_tipo: 'sala',
            modalidade: 'presencial',
            dia_semana: TERCA,
            horario_turno_id: horario.id,
            ativo: true,
        });

        expect(matriz.pendentes).toHaveLength(1);
        expect(matriz.totais).toEqual({ aulas: 2, comLocal: 1, semLocal: 1, semProfessor: 1 });
    });
});

// ---------------------------------------------------------------------------
// Mover, copiar, inativar, reativar e remover
// ---------------------------------------------------------------------------
describe('operacoes sobre uma aula existente', () => {
    test('mover reaproveita a validacao e recusa slot ocupado', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });
        const primeiro = await bd.horarioDoTurno('matutino', 1);
        const segundo = await bd.horarioDoTurno('matutino', 2);

        const aulaA = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: primeiro.id,
        });
        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: outra.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: segundo.id,
        });

        const erro = await capturarConflito(() =>
            aulaService.mover(aulaA.id, { diaSemana: SEGUNDA, horarioTurnoId: segundo.id })
        );
        expect(tipos(erro.detalhes)).toContain('turma');

        const movida = await aulaService.mover(aulaA.id, {
            diaSemana: TERCA,
            horarioTurnoId: segundo.id,
        });
        expect(movida.dia_semana).toBe(TERCA);
        expect(movida.horario_turno_id).toBe(segundo.id);
    });

    test('mover a aula para o mesmo lugar nao acusa conflito com ela mesma', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        const mesma = await aulaService.mover(aula.id, {
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        expect(mesma.id).toBe(aula.id);
    });

    test('copiar gera uma nova aula em outro slot', async () => {
        const { turma, disciplina, professor } = await cenarioBasico();
        const primeiro = await bd.horarioDoTurno('matutino', 1);
        const terceiro = await bd.horarioDoTurno('matutino', 3);

        const original = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: primeiro.id,
            observacao: 'Turma piloto',
        });

        const copia = await aulaService.copiar(original.id, {
            diaSemana: QUARTA,
            horarioTurnoId: terceiro.id,
        });

        expect(copia.id).not.toBe(original.id);
        expect(copia.disciplina_id).toBe(disciplina.id);
        expect(copia.professor_id).toBe(professor.id);
        expect(copia.observacao).toBe('Turma piloto');
        expect(copia.dia_semana).toBe(QUARTA);

        const aulas = await aulaService.listarDaTurma(turma.id);
        expect(aulas).toHaveLength(2);
    });

    test('inativar preserva o registro e libera o slot; reativar revalida', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const outra = await bd.criarDisciplina({ nome: 'Algoritmos' });
        const horario = await bd.horarioDoTurno('matutino', 1);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        await aulaService.inativar(aula.id);

        const guardada = await aulaService.obter(aula.id);
        expect(guardada.ativo).toBe(false);

        // Slot livre: outra aula pode ocupar o mesmo lugar.
        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: outra.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        const erro = await capturarConflito(() => aulaService.reativar(aula.id));
        expect(tipos(erro.detalhes)).toContain('turma');
    });

    test('remover exclui de verdade', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        await aulaService.remover(aula.id);

        await expect(aulaService.obter(aula.id)).rejects.toThrow('Aula não encontrada.');
    });

    test('atualizar nao aceita campos fora do contrato (mass assignment)', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        const atualizada = await aulaService.atualizar(aula.id, {
            observacao: 'Sala trocada',
            id: 999999,
            ativo: false,
            criado_em: '1999-01-01',
        });

        expect(atualizada.id).toBe(aula.id);
        expect(atualizada.observacao).toBe('Sala trocada');
        expect(atualizada.ativo).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------
describe('criarEmLote', () => {
    test('grava tudo quando nao ha conflito', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const primeiro = await bd.horarioDoTurno('matutino', 1);
        const segundo = await bd.horarioDoTurno('matutino', 2);

        const resultado = await aulaService.criarEmLote([
            {
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: primeiro.id,
            },
            {
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: segundo.id,
            },
        ]);

        expect(resultado.conflitos).toHaveLength(0);
        expect(resultado.criadas).toHaveLength(2);

        const aulas = await aulaService.listarDaTurma(turma.id);
        expect(aulas).toHaveLength(2);
    });

    test('faz rollback completo quando um item conflita', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const primeiro = await bd.horarioDoTurno('matutino', 1);
        const segundo = await bd.horarioDoTurno('matutino', 2);

        const resultado = await aulaService.criarEmLote([
            {
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: primeiro.id,
            },
            {
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: segundo.id,
            },
            {
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: primeiro.id,
            },
        ]);

        expect(resultado.criadas).toHaveLength(0);
        expect(resultado.conflitos.length).toBeGreaterThan(0);
        expect(resultado.conflitos[0].indice).toBe(2);
        expect(resultado.conflitos[0].tipo).toBe('turma');

        const aulas = await aulaService.listarDaTurma(turma.id);
        expect(aulas).toHaveLength(0);
    });

    test('detecta conflito entre itens do proprio lote', async () => {
        const { turma, disciplina, professor } = await cenarioBasico();
        const outraTurma = await bd.criarTurma({ codigo: 'ADS03', turnoSlug: 'matutino' });
        const horario = await bd.horarioDoTurno('matutino', 1);

        const resultado = await aulaService.criarEmLote([
            {
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            },
            {
                turmaId: outraTurma.id,
                disciplinaId: disciplina.id,
                professorId: professor.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            },
        ]);

        expect(resultado.criadas).toHaveLength(0);
        expect(resultado.conflitos[0].tipo).toBe('professor');
        expect(resultado.conflitos[0].indice).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Pre-visualizacao
// ---------------------------------------------------------------------------
describe('prevendoConflitos', () => {
    test('nao grava nada e ignora a propria aula quando pedido', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        const aula = await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        const comConflito = await aulaService.prevendoConflitos({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });
        expect(comConflito).toHaveLength(1);

        const semConflito = await aulaService.prevendoConflitos(
            {
                turmaId: turma.id,
                disciplinaId: disciplina.id,
                diaSemana: SEGUNDA,
                horarioTurnoId: horario.id,
            },
            { ignorarAulaId: aula.id }
        );
        expect(semConflito).toHaveLength(0);

        const aulas = await aulaService.listarDaTurma(turma.id);
        expect(aulas).toHaveLength(1);
    });

    test('responde mesmo com o formulario pela metade', async () => {
        const { turma, disciplina, professor } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        // Sem disciplina escolhida ainda: a pre-visualizacao nao pode explodir.
        const conflitos = await aulaService.prevendoConflitos({
            turmaId: turma.id,
            professorId: professor.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        expect(tipos(conflitos)).toEqual(expect.arrayContaining(['turma', 'professor']));

        // Sem turma nenhuma: devolve orientacao, nao excecao.
        const semTurma = await aulaService.prevendoConflitos({ diaSemana: SEGUNDA });
        expect(semTurma).toHaveLength(1);
        expect(semTurma[0].mensagem).toBe('Selecione a turma da aula.');
    });

    test('verificarConflitos aceita tanto o modulo db quanto um cliente de transacao', async () => {
        const { turma, disciplina } = await cenarioBasico();
        const horario = await bd.horarioDoTurno('matutino', 1);

        await aulaService.criar({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        });

        const dados = {
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            diaSemana: SEGUNDA,
            horarioTurnoId: horario.id,
        };

        const semTransacao = await conflitoService.verificarConflitos(db, dados);
        const comTransacao = await db.transacao((cliente) =>
            conflitoService.verificarConflitos(cliente, dados, { bloquear: true })
        );

        expect(semTransacao).toHaveLength(1);
        expect(comTransacao).toHaveLength(1);
        expect(comTransacao[0].tipo).toBe('turma');
    });
});
