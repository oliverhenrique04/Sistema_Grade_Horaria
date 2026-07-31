/**
 * Horarios do turno (`repositories/horarioTurnoRepository`).
 *
 * As duas regras estruturais sao garantidas pelo proprio banco e testadas aqui
 * contra o PostgreSQL de verdade:
 *  - todo periodo tem exatamente 50 minutos (CHECK `ck_horario_duracao_50min`);
 *  - horarios ATIVOS do mesmo turno nao podem se sobrepor (trigger
 *    `tg_valida_sobreposicao_horario`), mas intervalos entre periodos e faixas
 *    identicas em turnos diferentes sao permitidos.
 */
const bd = require('./helpers/db');
const horarioTurnoRepository = require('../src/repositories/horarioTurnoRepository');

/** Turno exclusivo destes testes, para nao mexer na carga do seed. */
let turnoTeste;

const inserir = (dados) =>
    horarioTurnoRepository.inserir({
        turnoId: turnoTeste.id,
        nome: dados.nome || 'Período de teste',
        ordem: dados.ordem,
        horaInicio: dados.horaInicio,
        horaFim: dados.horaFim,
        ativo: dados.ativo === undefined ? true : dados.ativo,
    });

beforeAll(async () => {
    const resultado = await bd.query(
        `INSERT INTO turnos (nome, slug, ordem, ativo)
         VALUES ('Turno de Teste', 'turno-de-teste', 90, TRUE)
         ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING *`
    );
    turnoTeste = resultado.rows[0];
});

beforeEach(async () => {
    await bd.limparDados();
    await bd.query('DELETE FROM horarios_turno WHERE turno_id = $1', [turnoTeste.id]);
});

afterAll(async () => {
    await bd.query('DELETE FROM horarios_turno WHERE turno_id = $1', [turnoTeste.id]);
    await bd.query('DELETE FROM turnos WHERE id = $1', [turnoTeste.id]);
    await bd.encerrar();
});

// ---------------------------------------------------------------------------
// Duracao do periodo
// ---------------------------------------------------------------------------
describe('duracao do periodo', () => {
    test('aceita exatamente 50 minutos', async () => {
        const horario = await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });

        expect(horario.id).toBeGreaterThan(0);
        expect(String(horario.hora_inicio)).toBe('07:10:00');
        expect(String(horario.hora_fim)).toBe('08:00:00');
    });

    test('recusa 40 minutos', async () => {
        await expect(
            inserir({ ordem: 1, horaInicio: '07:10', horaFim: '07:50' })
        ).rejects.toMatchObject({
            code: '23514',
            constraint: 'ck_horario_duracao_50min',
        });
    });

    test('recusa 60 minutos', async () => {
        await expect(
            inserir({ ordem: 1, horaInicio: '07:00', horaFim: '08:00' })
        ).rejects.toMatchObject({
            code: '23514',
            constraint: 'ck_horario_duracao_50min',
        });
    });
});

// ---------------------------------------------------------------------------
// Sobreposicao
// ---------------------------------------------------------------------------
describe('sobreposicao de horarios', () => {
    test('recusa dois horarios ativos que se sobrepoem no mesmo turno', async () => {
        await inserir({ nome: '1º horário', ordem: 1, horaInicio: '07:10', horaFim: '08:00' });

        await expect(
            inserir({ nome: '2º horário', ordem: 2, horaInicio: '07:30', horaFim: '08:20' })
        ).rejects.toThrow(/se sobrep[õo]e/i);
    });

    test('aceita periodos encostados (fim de um = inicio do outro)', async () => {
        await inserir({ nome: '1º horário', ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        const segundo = await inserir({
            nome: '2º horário',
            ordem: 2,
            horaInicio: '08:00',
            horaFim: '08:50',
        });

        expect(String(segundo.hora_inicio)).toBe('08:00:00');
    });

    test('aceita intervalo entre periodos', async () => {
        await inserir({ nome: '3º horário', ordem: 3, horaInicio: '08:50', horaFim: '09:40' });
        const quarto = await inserir({
            nome: '4º horário',
            ordem: 4,
            horaInicio: '09:50',
            horaFim: '10:40',
        });

        expect(String(quarto.hora_inicio)).toBe('09:50:00');
    });

    test('horario inativo nao bloqueia a faixa', async () => {
        await inserir({
            nome: 'Antigo',
            ordem: 10,
            horaInicio: '14:00',
            horaFim: '14:50',
            ativo: false,
        });
        const novo = await inserir({
            nome: 'Novo',
            ordem: 11,
            horaInicio: '14:00',
            horaFim: '14:50',
        });

        expect(novo.ativo).toBe(true);
    });

    test('a mesma faixa em turnos diferentes e permitida (Matutino x Integral)', async () => {
        const matutino = await bd.horarioDoTurno('matutino', 5);
        const integral = await bd.horarioDoTurno('integral', 5);

        expect(String(matutino.hora_inicio)).toBe(String(integral.hora_inicio));
        expect(String(matutino.hora_fim)).toBe(String(integral.hora_fim));
        expect(matutino.turno_id).not.toBe(integral.turno_id);

        // E o proprio turno de teste tambem pode repetir a faixa.
        const proprio = await inserir({ ordem: 20, horaInicio: '10:40', horaFim: '11:30' });
        expect(String(proprio.hora_inicio)).toBe('10:40:00');
    });

    test('a ordem e unica dentro do turno', async () => {
        await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });

        await expect(
            inserir({ ordem: 1, horaInicio: '08:00', horaFim: '08:50' })
        ).rejects.toMatchObject({
            code: '23505',
        });
    });
});

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
describe('consultas', () => {
    test('listarPorTurno respeita apenasAtivos e ordena pela ordem', async () => {
        await inserir({ nome: '2º horário', ordem: 2, horaInicio: '08:00', horaFim: '08:50' });
        await inserir({ nome: '1º horário', ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        await inserir({
            nome: 'Desativado',
            ordem: 3,
            horaInicio: '09:00',
            horaFim: '09:50',
            ativo: false,
        });

        const ativos = await horarioTurnoRepository.listarPorTurno(turnoTeste.id);
        expect(ativos.map((item) => item.ordem)).toEqual([1, 2]);

        const todos = await horarioTurnoRepository.listarPorTurno(turnoTeste.id, {
            apenasAtivos: false,
        });
        expect(todos.map((item) => item.ordem)).toEqual([1, 2, 3]);
    });

    test('listarPorTurno devolve lista vazia para turno invalido', async () => {
        await expect(horarioTurnoRepository.listarPorTurno(null)).resolves.toEqual([]);
    });

    test('buscarPorId traz os dados do turno', async () => {
        const criado = await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        const horario = await horarioTurnoRepository.buscarPorId(criado.id);

        expect(horario.turno_nome).toBe('Turno de Teste');
        expect(horario.turno_slug).toBe('turno-de-teste');
        expect(await horarioTurnoRepository.buscarPorId(999999)).toBeNull();
    });

    test('listarTodos e contar aplicam filtros e paginacao', async () => {
        await inserir({ nome: '1º horário', ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        await inserir({ nome: '2º horário', ordem: 2, horaInicio: '08:00', horaFim: '08:50' });
        await inserir({
            nome: 'Reforço',
            ordem: 3,
            horaInicio: '09:00',
            horaFim: '09:50',
            ativo: false,
        });

        const total = await horarioTurnoRepository.contar({ turnoId: turnoTeste.id });
        expect(total).toBe(3);

        const somenteAtivos = await horarioTurnoRepository.contar({
            turnoId: turnoTeste.id,
            ativo: true,
        });
        expect(somenteAtivos).toBe(2);

        const busca = await horarioTurnoRepository.listarTodos({
            turnoId: turnoTeste.id,
            busca: 'Reforço',
        });
        expect(busca).toHaveLength(1);
        expect(busca[0].nome).toBe('Reforço');
        expect(busca[0].turno_nome).toBe('Turno de Teste');

        const primeiraPagina = await horarioTurnoRepository.listarTodos({
            turnoId: turnoTeste.id,
            pagina: 1,
            porPagina: 2,
        });
        expect(primeiraPagina).toHaveLength(2);

        const segundaPagina = await horarioTurnoRepository.listarTodos({
            turnoId: turnoTeste.id,
            pagina: 2,
            porPagina: 2,
        });
        expect(segundaPagina).toHaveLength(1);
    });

    test('proximaOrdem sugere a proxima posicao livre', async () => {
        expect(await horarioTurnoRepository.proximaOrdem(turnoTeste.id)).toBe(1);

        await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        await inserir({ ordem: 2, horaInicio: '08:00', horaFim: '08:50' });

        expect(await horarioTurnoRepository.proximaOrdem(turnoTeste.id)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Alteracao e remocao
// ---------------------------------------------------------------------------
describe('alteracao e remocao', () => {
    test('atualizar troca a faixa mantendo os 50 minutos', async () => {
        const criado = await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });

        const atualizado = await horarioTurnoRepository.atualizar(criado.id, {
            turnoId: turnoTeste.id,
            nome: '1º horário (novo)',
            ordem: 1,
            horaInicio: '07:20',
            horaFim: '08:10',
            ativo: true,
        });

        expect(atualizado.nome).toBe('1º horário (novo)');
        expect(String(atualizado.hora_inicio)).toBe('07:20:00');
        expect(
            await horarioTurnoRepository.atualizar(999999, {
                turnoId: turnoTeste.id,
                nome: 'x',
                ordem: 99,
                horaInicio: '07:10',
                horaFim: '08:00',
            })
        ).toBeNull();
    });

    test('atualizar recusa faixa que passa a se sobrepor', async () => {
        await inserir({ nome: '1º horário', ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        const segundo = await inserir({
            nome: '2º horário',
            ordem: 2,
            horaInicio: '08:00',
            horaFim: '08:50',
        });

        await expect(
            horarioTurnoRepository.atualizar(segundo.id, {
                turnoId: turnoTeste.id,
                nome: '2º horário',
                ordem: 2,
                horaInicio: '07:30',
                horaFim: '08:20',
                ativo: true,
            })
        ).rejects.toThrow(/se sobrep[õo]e/i);
    });

    test('definirAtivo liga e desliga sem apagar o registro', async () => {
        const criado = await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });

        const desligado = await horarioTurnoRepository.definirAtivo(criado.id, false);
        expect(desligado.ativo).toBe(false);

        const religado = await horarioTurnoRepository.definirAtivo(criado.id, true);
        expect(religado.ativo).toBe(true);
    });

    test('emUso indica quando alguma aula referencia o horario', async () => {
        const horario = await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        expect(await horarioTurnoRepository.emUso(horario.id)).toBe(false);

        const turma = await bd.criarTurma({ turnoId: turnoTeste.id, codigo: 'TST01' });
        await bd.criarAula({ turmaId: turma.id, horarioTurnoId: horario.id, diaSemana: 1 });

        expect(await horarioTurnoRepository.emUso(horario.id)).toBe(true);
        expect(await horarioTurnoRepository.contarAulas(horario.id)).toEqual({
            total: 1,
            ativas: 1,
        });
    });

    test('horario em uso nao pode ser excluido destrutivamente', async () => {
        const horario = await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });
        const turma = await bd.criarTurma({ turnoId: turnoTeste.id, codigo: 'TST02' });
        await bd.criarAula({ turmaId: turma.id, horarioTurnoId: horario.id, diaSemana: 1 });

        expect(await horarioTurnoRepository.emUso(horario.id)).toBe(true);
        await expect(horarioTurnoRepository.excluir(horario.id)).rejects.toMatchObject({
            code: '23503',
        });

        // O caminho seguro e inativar.
        const inativado = await horarioTurnoRepository.definirAtivo(horario.id, false);
        expect(inativado.ativo).toBe(false);
    });

    test('horario livre pode ser excluido', async () => {
        const horario = await inserir({ ordem: 1, horaInicio: '07:10', horaFim: '08:00' });

        expect(await horarioTurnoRepository.emUso(horario.id)).toBe(false);
        expect(await horarioTurnoRepository.excluir(horario.id)).toBe(true);
        expect(await horarioTurnoRepository.buscarPorId(horario.id)).toBeNull();
        expect(await horarioTurnoRepository.excluir(horario.id)).toBe(false);
    });
});
