/**
 * Carga da grade horaria a partir do cubo do TOTVS Educacional.
 *
 * ---------------------------------------------------------------------------
 * PREVIA E GRAVACAO PERCORREM O MESMO CAMINHO
 * ---------------------------------------------------------------------------
 * `simular` e `aplicar` executam exatamente as mesmas etapas, na mesma
 * transacao; a simulacao apenas termina com ROLLBACK. Isso custa uma transacao
 * de escrita a mais, e em troca a previa nunca mente: ela ja passou pelo CHECK
 * de 50 minutos dos horarios, pelo gatilho de sobreposicao e pelos indices
 * unicos. Um relatorio calculado "por fora" prometeria coisas que a gravacao
 * real poderia recusar.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCIA
 * ---------------------------------------------------------------------------
 * Nenhuma etapa cria registro que ja exista:
 *   campus       codigo externo (FILIAL) e, na primeira carga, nome sem acento;
 *   curso        CODCURSO e, na primeira carga, nome sem acento;
 *   disciplina   CODDISC e, quando ele falta, nome sem acento;
 *   professor    CHAPA e, na primeira carga, nome sem acento;
 *   turma        codigo dentro do periodo letivo e do campus;
 *   aula         `origem_chave` = oferta + dia + hora inicial.
 * Recarregar o mesmo arquivo atualiza o que mudou e nao cria nada novo.
 */
const db = require('../config/db');
const importacaoRepository = require('../repositories/importacaoRepository');
const cubo = require('./importacao/cuboTotvs');
const { lerPrimeiraAba } = require('../utils/planilha');
const { chave, titulo, limitar } = require('../utils/textos');
const { ErroValidacao } = require('../utils/erros');

/** Duracao fixa de um periodo de aula, garantida por CHECK no banco. */
const DURACAO_PERIODO = 50;

/**
 * Sobreposicao minima para aproveitar um periodo ja cadastrado quando a faixa
 * da planilha nao bate exatamente. Abaixo disso a aula entra sem horario e vira
 * pendencia visivel, em vez de ser encaixada num periodo que nao e o dela.
 */
const SOBREPOSICAO_MINIMA = 0.5;

/**
 * Desvio maximo tolerado para derivar um periodo a partir de uma faixa que nao
 * dura 50 minutos. O cubo traz algumas aulas como 14:30-15:30 (60 min); acima
 * desse limite a faixa descreve outra coisa (um turno inteiro, um plantao) e
 * inventar um periodo de 50 minutos seria arbitrario.
 */
const DESVIO_MAXIMO_PERIODO = 20;

/** Sinalizador usado para desfazer a transacao ao fim de uma simulacao. */
const DESFAZER = Symbol('simulacao');

/**
 * Prefixos usados na leitura do nome do campus vindo do ERP
 * ("EUROAM - MATRIZ ASA SUL" e o campus "Asa Sul").
 */
const RUIDO_NO_NOME_DA_FILIAL = [/^EUROAM\s*-\s*/i, /^MATRIZ\s+/i, /^UNIDADE\s+/i, /^CAMPUS\s+/i];

/**
 * Nome apresentavel de campus a partir do texto da filial.
 * @param {string} filial
 * @returns {string}
 */
const nomeDoCampus = (filial) => {
    let bruto = String(filial || '').trim();
    RUIDO_NO_NOME_DA_FILIAL.forEach((padrao) => {
        bruto = bruto.replace(padrao, '');
    });
    return limitar(titulo(bruto) || filial, 120);
};

/**
 * Sigla sugerida a partir das iniciais do nome ("Águas Claras" -> "AC").
 * @param {string} nome
 * @returns {string|null}
 */
const siglaDoNome = (nome) => {
    const iniciais = chave(nome)
        .split(' ')
        .filter((palavra) => palavra.length > 2)
        .map((palavra) => palavra[0])
        .join('');
    return iniciais ? iniciais.slice(0, 20) : null;
};

/** Minutos desde a meia-noite em "HH:MM". */
const minutosParaHora = (minutos) => {
    const horas = String(Math.floor(minutos / 60)).padStart(2, '0');
    const resto = String(minutos % 60).padStart(2, '0');
    return `${horas}:${resto}`;
};

/** Converte "HH:MM" em minutos. */
const emMinutos = (hora) => {
    const partes = /^(\d{2}):(\d{2})/.exec(String(hora || ''));
    return partes ? Number(partes[1]) * 60 + Number(partes[2]) : null;
};

/**
 * Interseccao entre duas faixas de tempo, em minutos.
 * @returns {number}
 */
const interseccao = (inicioA, fimA, inicioB, fimB) =>
    Math.max(0, Math.min(fimA, fimB) - Math.max(inicioA, inicioB));

/**
 * Acumulador de contagens do relatorio.
 * @returns {{registrar:Function, valores:Record<string, number>}}
 */
const criarContadores = () => {
    const valores = {};
    return {
        valores,
        registrar(nome, quantidade = 1) {
            if (!quantidade) return;
            valores[nome] = (valores[nome] || 0) + quantidade;
        },
    };
};

// ---------------------------------------------------------------------------
// Etapas da carga
// ---------------------------------------------------------------------------

/**
 * Resolve o periodo letivo de destino.
 * @param {object} cliente
 * @param {object} interpretacao
 * @param {{periodoLetivoId?:number|null}} opcoes
 * @returns {Promise<{periodo:object, criado:boolean}>}
 */
const resolverPeriodo = async (cliente, interpretacao, opcoes) => {
    const periodos = await importacaoRepository.listarPeriodos(cliente);

    if (opcoes.periodoLetivoId) {
        const escolhido = periodos.find(
            (periodo) => Number(periodo.id) === Number(opcoes.periodoLetivoId)
        );
        if (!escolhido) {
            throw new ErroValidacao('Período letivo inválido.', {
                periodoLetivoId: 'Selecione um período letivo existente.',
            });
        }
        return { periodo: escolhido, criado: false };
    }

    if (!interpretacao.periodo) {
        throw new ErroValidacao('Período letivo não identificado.', {
            periodoLetivoId:
                'A planilha não traz as datas da disciplina. Selecione o período letivo de destino.',
        });
    }

    const existente = periodos.find((periodo) => periodo.codigo === interpretacao.periodo.codigo);
    if (existente) return { periodo: existente, criado: false };

    const criado = await importacaoRepository.criarPeriodo(interpretacao.periodo, cliente);
    return { periodo: criado, criado: true };
};

/**
 * Casa (ou cria) os campus da planilha.
 * @returns {Promise<Map<string, object>>} codigo externo normalizado -> campus
 */
const resolverCampus = async (cliente, interpretacao, contadores) => {
    const existentes = await importacaoRepository.listarCampus(cliente);
    const porCodigo = new Map(
        existentes
            .filter((item) => item.codigo_externo)
            .map((item) => [chave(item.codigo_externo), item])
    );
    const porNome = new Map(existentes.map((item) => [chave(item.nome), item]));

    const mapa = new Map();
    const aCriar = [];
    const aVincular = [];

    interpretacao.campus.forEach((item) => {
        const codigo = chave(item.codigoExterno);
        const jaVinculado = porCodigo.get(codigo);
        if (jaVinculado) {
            mapa.set(codigo, jaVinculado);
            return;
        }

        // Primeira carga: o campus ja existe cadastrado a mao, so falta a
        // ligacao com o codigo do ERP.
        const nome = nomeDoCampus(item.codigoExterno);
        const porNomeExistente = porNome.get(chave(nome)) || porNome.get(codigo);

        if (porNomeExistente) {
            mapa.set(codigo, porNomeExistente);
            aVincular.push({ id: porNomeExistente.id, codigoExterno: item.codigoExterno });
            return;
        }

        aCriar.push({ nome, sigla: siglaDoNome(nome), codigoExterno: item.codigoExterno });
    });

    contadores.registrar(
        'campusVinculados',
        await importacaoRepository.vincularCodigoExternoCampus(aVincular, cliente)
    );

    const criados = await importacaoRepository.criarCampus(aCriar, cliente);
    criados.forEach((linha) => mapa.set(chave(linha.codigo_externo), linha));
    contadores.registrar('campusCriados', criados.length);

    return mapa;
};

/**
 * Casa (ou cria) os cursos da planilha.
 * @returns {Promise<Map<string, object>>} id logico do curso -> curso
 */
const resolverCursos = async (cliente, interpretacao, contadores) => {
    const existentes = await importacaoRepository.listarCursos(cliente);
    const porCodigo = new Map(
        existentes.filter((item) => item.codigo).map((item) => [chave(item.codigo), item])
    );
    const porNome = new Map(existentes.map((item) => [chave(item.nome), item]));

    const mapa = new Map();
    const aCriar = [];
    const aVincular = [];

    interpretacao.cursos.forEach((curso) => {
        const codigo = curso.codigo ? chave(curso.codigo) : null;
        const existentePorCodigo = codigo ? porCodigo.get(codigo) : null;

        if (existentePorCodigo) {
            mapa.set(curso.id, existentePorCodigo);
            return;
        }

        const existentePorNome = porNome.get(chave(curso.nome));
        if (existentePorNome) {
            mapa.set(curso.id, existentePorNome);
            if (curso.codigo) {
                aVincular.push({
                    id: existentePorNome.id,
                    codigo: curso.codigo,
                    sigla: curso.sigla,
                });
            }
            return;
        }

        aCriar.push({
            id: curso.id,
            nome: limitar(curso.nome, 120),
            sigla: curso.sigla ? limitar(curso.sigla, 20) : null,
            codigo: curso.codigo || null,
        });
    });

    contadores.registrar(
        'cursosVinculados',
        await importacaoRepository.vincularCodigoCurso(aVincular, cliente)
    );

    const criados = await importacaoRepository.criarCursos(aCriar, cliente);
    criados.forEach((linha, indice) => mapa.set(aCriar[indice].id, linha));
    contadores.registrar('cursosCriados', criados.length);

    return mapa;
};

/**
 * Casa (ou cria) as disciplinas da planilha.
 * @returns {Promise<Map<string, object>>} CODDISC (ou nome) -> disciplina
 */
const resolverDisciplinas = async (cliente, interpretacao, contadores) => {
    const existentes = await importacaoRepository.listarDisciplinas(cliente);
    const porCodigo = new Map(
        existentes.filter((item) => item.codigo).map((item) => [chave(item.codigo), item])
    );
    const porNome = new Map(existentes.map((item) => [chave(item.nome), item]));

    const mapa = new Map();
    const aCriar = [];
    const aAtualizar = [];

    interpretacao.disciplinas.forEach((disciplina) => {
        const existente = disciplina.codigo
            ? porCodigo.get(chave(disciplina.codigo))
            : porNome.get(chave(disciplina.nome));

        if (existente) {
            mapa.set(disciplina.codigo || chave(disciplina.nome), existente);
            aAtualizar.push({
                id: existente.id,
                nome: disciplina.nome,
                cargaHoraria: disciplina.cargaHoraria,
            });
            return;
        }

        aCriar.push({
            referencia: disciplina.codigo || chave(disciplina.nome),
            nome: disciplina.nome,
            codigo: disciplina.codigo ? limitar(disciplina.codigo, 30) : null,
            cargaHoraria: disciplina.cargaHoraria,
        });
    });

    contadores.registrar(
        'disciplinasAtualizadas',
        await importacaoRepository.atualizarDisciplinas(aAtualizar, cliente)
    );

    const criadas = await importacaoRepository.criarDisciplinas(aCriar, cliente);
    criadas.forEach((linha, indice) => mapa.set(aCriar[indice].referencia, linha));
    contadores.registrar('disciplinasCriadas', criadas.length);

    return mapa;
};

/**
 * Casa (ou cria) os professores da planilha, usando a chapa como identidade.
 * @returns {Promise<Map<string, object>>} matricula -> professor
 */
const resolverProfessores = async (cliente, interpretacao, contadores) => {
    const existentes = await importacaoRepository.listarProfessores(cliente);
    const porMatricula = new Map(
        existentes.filter((item) => item.matricula).map((item) => [chave(item.matricula), item])
    );
    const porNome = new Map(existentes.map((item) => [chave(item.nome), item]));

    const mapa = new Map();
    const aCriar = [];
    const aVincular = [];

    interpretacao.professores.forEach((professor) => {
        const matricula = chave(professor.matricula);
        const existentePorMatricula = porMatricula.get(matricula);

        if (existentePorMatricula) {
            mapa.set(professor.matricula, existentePorMatricula);
            return;
        }

        const existentePorNome = porNome.get(chave(professor.nome));
        if (existentePorNome) {
            mapa.set(professor.matricula, existentePorNome);
            aVincular.push({ id: existentePorNome.id, matricula: professor.matricula });
            return;
        }

        aCriar.push({ nome: professor.nome, matricula: limitar(professor.matricula, 30) });
    });

    contadores.registrar(
        'professoresVinculados',
        await importacaoRepository.vincularMatriculaProfessor(aVincular, cliente)
    );

    const criados = await importacaoRepository.criarProfessores(aCriar, cliente);
    criados.forEach((linha, indice) => mapa.set(aCriar[indice].matricula, linha));
    contadores.registrar('professoresCriados', criados.length);

    return mapa;
};

/**
 * Garante que cada turno tenha os periodos de 50 minutos exigidos pela planilha.
 *
 * So cria faixa que (a) dura exatamente 50 minutos e (b) nao encosta em nenhum
 * periodo ja existente do turno — o gatilho do banco recusaria a sobreposicao, e
 * de todo modo uma faixa deslocada em cinco minutos e a mesma aula, nao outra.
 *
 * @returns {Promise<{turnos:Map<string, object>, criados:number}>}
 */
const garantirHorarios = async (cliente, turnosNecessarios, contadores) => {
    let turnos = await importacaoRepository.listarTurnosComHorarios(cliente);
    const porSlug = new Map(turnos.map((turno) => [turno.slug, turno]));

    const aCriar = [];
    const turnosAfetados = new Set();

    turnosNecessarios.forEach((faixas, slug) => {
        const turno = porSlug.get(slug);
        if (!turno) return;

        const ocupadas = turno.horarios.map((horario) => ({
            inicio: emMinutos(horario.horaInicio),
            fim: emMinutos(horario.horaFim),
        }));

        const livre = (inicio, fim) =>
            !ocupadas.some((periodo) => periodo.inicio < fim && inicio < periodo.fim);

        /**
         * Periodo de 50 minutos que representa a faixa da planilha.
         *
         * Faixa de 50 minutos entra como esta. Faixa um pouco maior (o cubo tem
         * aulas de 60 min) vira o periodo alinhado ao inicio ou ao fim — o que
         * couber sem encostar nos periodos ja existentes. Sem isso, o encaixe
         * dependeria de outra turma ter pedido a mesma faixa antes, e a carga
         * daria resultados diferentes conforme a ordem.
         */
        const derivarPeriodo = (faixa) => {
            const duracao = faixa.fim - faixa.inicio;
            if (duracao === DURACAO_PERIODO) {
                return livre(faixa.inicio, faixa.fim) ? [faixa.inicio, faixa.fim] : null;
            }

            if (duracao < DURACAO_PERIODO || duracao > DURACAO_PERIODO + DESVIO_MAXIMO_PERIODO) {
                return null;
            }

            const candidatos = [
                [faixa.inicio, faixa.inicio + DURACAO_PERIODO],
                [faixa.fim - DURACAO_PERIODO, faixa.fim],
            ];

            return candidatos.find(([inicio, fim]) => livre(inicio, fim)) || null;
        };

        [...faixas]
            .sort((a, b) => a.inicio - b.inicio)
            .forEach((faixa) => {
                const periodo = derivarPeriodo(faixa);
                if (!periodo) return;

                const [inicio, fim] = periodo;
                ocupadas.push({ inicio, fim });
                turnosAfetados.add(turno.id);
                aCriar.push({
                    turnoId: turno.id,
                    nome: importacaoRepository.NOME_PROVISORIO,
                    ordem: 900 + aCriar.length,
                    horaInicio: minutosParaHora(inicio),
                    horaFim: minutosParaHora(fim),
                });
            });
    });

    if (aCriar.length > 0) {
        await importacaoRepository.criarHorarios(aCriar, cliente);
        for (const turnoId of turnosAfetados) {
            await importacaoRepository.renumerarHorarios(turnoId, cliente);
        }
        turnos = await importacaoRepository.listarTurnosComHorarios(cliente);
    }

    contadores.registrar('horariosCriados', aCriar.length);

    return {
        turnos: new Map(turnos.map((turno) => [turno.slug, turno])),
        criados: aCriar.map((item) => `${item.horaInicio}–${item.horaFim}`),
    };
};

/**
 * Encontra o periodo do turno que corresponde a faixa da planilha.
 * @param {object} turno turno com a lista de horarios
 * @param {{inicio:number, fim:number}} faixa
 * @returns {{horario:object|null, ajustado:boolean}}
 */
const casarHorario = (turno, faixa) => {
    if (!turno) return { horario: null, ajustado: false };

    const ativos = turno.horarios.filter((horario) => horario.ativo);

    const exato = ativos.find(
        (horario) =>
            emMinutos(horario.horaInicio) === faixa.inicio &&
            emMinutos(horario.horaFim) === faixa.fim
    );
    if (exato) return { horario: exato, ajustado: false };

    const duracao = faixa.fim - faixa.inicio;
    let melhor = null;
    let melhorSobreposicao = 0;

    ativos.forEach((horario) => {
        const inicio = emMinutos(horario.horaInicio);
        const fim = emMinutos(horario.horaFim);
        const comum = interseccao(faixa.inicio, faixa.fim, inicio, fim);
        if (comum > melhorSobreposicao) {
            melhorSobreposicao = comum;
            melhor = horario;
        }
    });

    if (!melhor) return { horario: null, ajustado: false };

    const periodo = emMinutos(melhor.horaFim) - emMinutos(melhor.horaInicio);
    const suficiente =
        melhorSobreposicao >= duracao * SOBREPOSICAO_MINIMA &&
        melhorSobreposicao >= periodo * SOBREPOSICAO_MINIMA;

    return suficiente ? { horario: melhor, ajustado: true } : { horario: null, ajustado: false };
};

/**
 * Casa (ou cria) as turmas da planilha e devolve o mapa de referencias.
 * @returns {Promise<Map<string, object>>} referencia da turma -> turma
 */
const resolverTurmas = async (
    cliente,
    interpretacao,
    { periodo, campus, cursos, turnos },
    contadores
) => {
    const existentes = await importacaoRepository.listarTurmasDoPeriodo(periodo.id, cliente);
    const porCampusCodigo = new Map(
        existentes.map((turma) => [`${turma.campus_id}|${chave(turma.codigo)}`, turma])
    );

    const mapa = new Map();
    const aCriar = [];
    const aAtualizar = [];

    interpretacao.turmas.forEach((turma) => {
        const campusDaTurma = campus.get(chave(turma.filial));
        const cursoDaTurma = turma.cursoId ? cursos.get(turma.cursoId) : null;
        const turnoDaTurma = turnos.get(turma.turnoSlug);

        if (!campusDaTurma || !cursoDaTurma || !turnoDaTurma) return;

        // A turma gerencial se apresenta pelo rotulo do cubo mais as turmas que
        // estudam juntas: "GPDIRM (DIR07M1 | DIR08M1)". E assim que o operador
        // distingue os varios grupos que dividem o mesmo codigo gerencial.
        const nome =
            turma.gerencial && turma.codigosDoGrupo.length > 0
                ? `${turma.grupoDe} (${turma.codigosDoGrupo.join(' | ')})`
                : turma.codigo;
        const dados = {
            nome: limitar(nome, 120),
            codigo: limitar(turma.codigo, 40),
            periodoLetivoId: periodo.id,
            campusId: campusDaTurma.id,
            cursoId: cursoDaTurma.id,
            semestreCurricular: turma.semestre,
            turnoId: turnoDaTurma.id,
            gerencial: turma.gerencial,
        };

        const existente = porCampusCodigo.get(`${campusDaTurma.id}|${chave(turma.codigo)}`);

        if (existente) {
            mapa.set(turma.id, existente);
            aAtualizar.push({ id: existente.id, ...dados });
            return;
        }

        aCriar.push({ referencia: turma.id, ...dados });
    });

    contadores.registrar(
        'turmasAtualizadas',
        await importacaoRepository.atualizarTurmas(aAtualizar, cliente)
    );

    const criadas = await importacaoRepository.criarTurmas(aCriar, cliente);
    criadas.forEach((linha, indice) => mapa.set(aCriar[indice].referencia, linha));
    contadores.registrar('turmasCriadas', criadas.length);

    // Ligacao entre a turma regular e a gerencial que oferta suas disciplinas
    // compartilhadas. Sem ela o vinculo do TOTVS se perderia na carga.
    const vinculos = [];
    interpretacao.turmas.forEach((turma) => {
        if (!turma.gerencialDe) return;
        const propria = mapa.get(turma.id);
        const gerencial = mapa.get(turma.gerencialDe);
        if (propria && gerencial && propria.id !== gerencial.id) {
            vinculos.push({ turmaId: propria.id, gerencialId: gerencial.id });
        }
    });

    contadores.registrar(
        'turmasVinculadas',
        await importacaoRepository.vincularTurmasGerenciais(vinculos, cliente)
    );

    return mapa;
};

/**
 * Monta e grava as aulas.
 * @returns {Promise<{gravadas:number, novas:number, atualizadas:number,
 *                    semHorario:number, recusadas:object[], inativadas:number}>}
 */
const gravarAulas = async (
    cliente,
    interpretacao,
    { turmas, disciplinas, professores, turnos, turnosDaTurma },
    opcoes,
    contadores
) => {
    const turmasIds = [...new Set([...turmas.values()].map((turma) => turma.id))];
    const existentes = await importacaoRepository.listarAulasDasTurmas(turmasIds, cliente);

    const porOrigem = new Map(
        existentes.filter((aula) => aula.origem_chave).map((aula) => [aula.origem_chave, aula])
    );

    // Slot ja ocupado por uma aula ativa da mesma disciplina — o indice unico
    // `ux_aula_turma_slot` recusaria a gravacao, entao a aula e reportada.
    const slotOcupado = new Map();
    existentes
        .filter((aula) => aula.ativo && aula.horario_turno_id)
        .forEach((aula) => {
            const slot = `${aula.turma_id}|${aula.dia_semana}|${aula.horario_turno_id}|${aula.disciplina_id}`;
            slotOcupado.set(slot, aula);
        });

    const aGravar = [];
    const recusadas = [];
    const equipes = new Map();
    /** origemChave -> turmas regulares que assistem a aula. */
    const assistentes = new Map();
    let semHorario = 0;
    let ajustadas = 0;

    interpretacao.aulas.forEach((aula) => {
        const turma = turmas.get(aula.turmaRef);
        if (!turma) {
            recusadas.push({ aula, motivo: 'turma não pôde ser criada' });
            return;
        }

        const disciplina = disciplinas.get(aula.disciplinaCodigo || chave(aula.disciplinaNome));
        if (!disciplina) {
            recusadas.push({ aula, motivo: 'disciplina não identificada' });
            return;
        }

        const turno = turnos.get(turnosDaTurma.get(aula.turmaRef));
        const { horario, ajustado } = casarHorario(turno, {
            inicio: aula.minutoInicio,
            fim: aula.minutoFim,
        });

        if (!horario) semHorario += 1;
        if (ajustado) ajustadas += 1;

        const slot = horario
            ? `${turma.id}|${aula.diaSemana}|${horario.id}|${disciplina.id}`
            : null;

        const conflitante = slot ? slotOcupado.get(slot) : null;
        if (conflitante && conflitante.origem_chave !== aula.origemChave) {
            recusadas.push({
                aula,
                motivo: 'o horário já está ocupado por outra aula desta turma e disciplina',
            });
            return;
        }

        if (slot) slotOcupado.set(slot, { origem_chave: aula.origemChave });

        const principal = aula.professorPrincipal
            ? professores.get(aula.professorPrincipal.matricula)
            : null;

        aGravar.push({
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: principal ? principal.id : null,
            diaSemana: aula.diaSemana,
            horarioTurnoId: horario ? horario.id : null,
            modalidade: aula.modalidade,
            origemChave: aula.origemChave,
        });

        assistentes.set(
            aula.origemChave,
            aula.turmasAtendidas.map((ref) => turmas.get(ref)).filter(Boolean)
        );

        equipes.set(
            aula.origemChave,
            aula.professores
                .map((item) => ({
                    professor: professores.get(item.matricula),
                    papel: item.papel,
                }))
                .filter((item) => item.professor)
        );
    });

    const gravadas = await importacaoRepository.gravarAulas(aGravar, cliente);

    const vinculos = [];
    const turmasQueAssistem = [];
    const aulasIds = [];

    gravadas.forEach((linha) => {
        aulasIds.push(linha.id);

        (equipes.get(linha.origem_chave) || []).forEach((item) => {
            vinculos.push({ aulaId: linha.id, professorId: item.professor.id, papel: item.papel });
        });

        (assistentes.get(linha.origem_chave) || []).forEach((turma) => {
            turmasQueAssistem.push({ aulaId: linha.id, turmaId: turma.id });
        });
    });

    await importacaoRepository.substituirProfessoresDasAulas(aulasIds, vinculos, cliente);

    const turmasVinculadasAsAulas = await importacaoRepository.substituirTurmasDasAulas(
        aulasIds,
        turmasQueAssistem,
        cliente
    );

    const novas = gravadas.filter((linha) => linha.inserida).length;

    let inativadas = 0;
    if (opcoes.inativarAusentes) {
        inativadas = await importacaoRepository.inativarAulasAusentes(
            turmasIds,
            aGravar.map((item) => item.origemChave),
            cliente
        );
    }

    contadores.registrar('aulasCriadas', novas);
    contadores.registrar('aulasAtualizadas', gravadas.length - novas);
    contadores.registrar('aulasInativadas', inativadas);
    contadores.registrar('professoresPorAula', vinculos.length);
    contadores.registrar('turmasPorAula', turmasVinculadasAsAulas);

    return {
        gravadas: gravadas.length,
        novas,
        atualizadas: gravadas.length - novas,
        semHorario,
        ajustadas,
        recusadas,
        inativadas,
        jaExistiam: porOrigem.size,
    };
};

// ---------------------------------------------------------------------------
// Orquestracao
// ---------------------------------------------------------------------------

/**
 * Executa a carga inteira dentro de uma transacao.
 * @param {object} interpretacao saida de `cuboTotvs.interpretar`
 * @param {{periodoLetivoId?:number|null, inativarAusentes?:boolean,
 *          arquivo?:string, usuarioId?:number|null, simular?:boolean}} opcoes
 * @returns {Promise<object>} relatorio
 */
const executar = async (interpretacao, opcoes = {}) => {
    const simular = opcoes.simular !== false;

    const rodar = async (cliente) => {
        const contadores = criarContadores();
        const avisos = [...interpretacao.avisos];

        const { periodo, criado: periodoCriado } = await resolverPeriodo(
            cliente,
            interpretacao,
            opcoes
        );
        if (periodoCriado) contadores.registrar('periodosCriados', 1);

        const [campus, cursos, disciplinas, professores] = [
            await resolverCampus(cliente, interpretacao, contadores),
            await resolverCursos(cliente, interpretacao, contadores),
            await resolverDisciplinas(cliente, interpretacao, contadores),
            await resolverProfessores(cliente, interpretacao, contadores),
        ];

        // Matriz curricular e oferta por campus, deduzidas da propria planilha.
        const paresCursoCampus = new Map();
        const turnosDaTurma = new Map();

        interpretacao.turmas.forEach((turma) => {
            turnosDaTurma.set(turma.id, turma.turnoSlug);
            const campusDaTurma = campus.get(chave(turma.filial));
            const cursoDaTurma = turma.cursoId ? cursos.get(turma.cursoId) : null;
            if (campusDaTurma && cursoDaTurma) {
                paresCursoCampus.set(`${cursoDaTurma.id}|${campusDaTurma.id}`, {
                    cursoId: cursoDaTurma.id,
                    campusId: campusDaTurma.id,
                });
            }
        });

        contadores.registrar(
            'cursoCampusCriados',
            await importacaoRepository.garantirCursoCampus([...paresCursoCampus.values()], cliente)
        );

        const paresCursoDisciplina = new Map();
        interpretacao.disciplinas.forEach((disciplina) => {
            const registro = disciplinas.get(disciplina.codigo || chave(disciplina.nome));
            if (!registro) return;
            disciplina.cursos.forEach((cursoRef) => {
                const curso = cursos.get(cursoRef);
                if (!curso) return;
                paresCursoDisciplina.set(`${curso.id}|${registro.id}`, {
                    cursoId: curso.id,
                    disciplinaId: registro.id,
                });
            });
        });

        contadores.registrar(
            'cursoDisciplinasCriados',
            await importacaoRepository.garantirCursoDisciplinas(
                [...paresCursoDisciplina.values()],
                cliente
            )
        );

        // Faixas de horario exigidas por turno DA TURMA: o periodo escolhido
        // precisa existir no turno em que a turma esta matriculada, senao a
        // aula nao aparece na grade dela.
        const faixasPorTurno = new Map();
        interpretacao.aulas.forEach((aula) => {
            const slug = turnosDaTurma.get(aula.turmaRef);
            if (!slug) return;
            if (!faixasPorTurno.has(slug)) faixasPorTurno.set(slug, new Map());
            faixasPorTurno.get(slug).set(`${aula.horaInicio}-${aula.horaFim}`, {
                inicio: aula.minutoInicio,
                fim: aula.minutoFim,
                horaInicio: aula.horaInicio,
                horaFim: aula.horaFim,
            });
        });

        const necessarias = new Map(
            [...faixasPorTurno].map(([slug, faixas]) => [slug, [...faixas.values()]])
        );

        const { turnos, criados: horariosCriados } = await garantirHorarios(
            cliente,
            necessarias,
            contadores
        );

        const turmas = await resolverTurmas(
            cliente,
            interpretacao,
            { periodo, campus, cursos, turnos },
            contadores
        );

        const aulas = await gravarAulas(
            cliente,
            interpretacao,
            { turmas, disciplinas, professores, turnos, turnosDaTurma },
            opcoes,
            contadores
        );

        if (aulas.semHorario > 0) {
            avisos.push({
                tipo: 'aula_sem_horario',
                mensagem: `${aulas.semHorario} aula(s) ficaram sem horário: a faixa da planilha não corresponde a nenhum período do turno da turma.`,
                detalhe: null,
            });
        }

        if (aulas.ajustadas > 0) {
            avisos.push({
                tipo: 'horario_ajustado',
                mensagem: `${aulas.ajustadas} aula(s) encaixadas no período mais próximo do turno (a planilha trazia faixa deslocada).`,
                detalhe: null,
            });
        }

        if (aulas.recusadas.length > 0) {
            avisos.push({
                tipo: 'aula_recusada',
                mensagem: `${aulas.recusadas.length} aula(s) não puderam ser gravadas.`,
                detalhe: aulas.recusadas
                    .slice(0, 20)
                    .map(
                        (item) =>
                            `${item.aula.disciplinaNome} (${item.aula.horaInicio}): ${item.motivo}`
                    ),
            });
        }

        if (horariosCriados.length > 0) {
            avisos.push({
                tipo: 'horario_criado',
                mensagem: `${horariosCriados.length} período(s) de 50 minutos criados nos turnos para acomodar a planilha.`,
                detalhe: horariosCriados,
            });
        }

        const relatorio = {
            simulacao: simular,
            periodo: {
                id: periodo.id,
                codigo: periodo.codigo,
                criado: periodoCriado,
                atual: periodo.atual,
            },
            detectado: interpretacao.periodo ? interpretacao.periodo.codigo : null,
            totais: interpretacao.totais,
            contagens: contadores.valores,
            aulas: {
                gravadas: aulas.gravadas,
                novas: aulas.novas,
                atualizadas: aulas.atualizadas,
                semHorario: aulas.semHorario,
                semLocal: aulas.gravadas,
                recusadas: aulas.recusadas.length,
                inativadas: aulas.inativadas,
            },
            avisos,
        };

        if (!simular) {
            await importacaoRepository.registrarImportacao(
                {
                    arquivo: opcoes.arquivo || null,
                    periodoLetivoId: periodo.id,
                    usuarioId: opcoes.usuarioId || null,
                    linhasLidas: interpretacao.totais.linhasLidas,
                    linhasConsideradas: interpretacao.totais.linhasConsideradas,
                    resumo: { contagens: contadores.valores, aulas: relatorio.aulas },
                    avisos,
                },
                cliente
            );
        }

        return relatorio;
    };

    if (!simular) return db.transacao(rodar);

    // Simulacao: percorre exatamente o mesmo caminho e desfaz tudo no final.
    try {
        await db.transacao(async (cliente) => {
            const relatorio = await rodar(cliente);
            const parada = new Error('simulacao concluida');
            parada[DESFAZER] = relatorio;
            throw parada;
        });
    } catch (erro) {
        if (erro && erro[DESFAZER]) return erro[DESFAZER];
        throw erro;
    }

    // Inalcancavel: `rodar` sempre lanca no modo simulacao.
    throw new Error('A simulação não produziu relatório.');
};

/**
 * Le a planilha e devolve a interpretacao do cubo.
 * @param {Buffer} conteudo
 * @returns {object}
 */
const interpretarArquivo = (conteudo) => {
    const { cabecalho, linhas } = lerPrimeiraAba(conteudo);

    const faltando = cubo.COLUNAS_OBRIGATORIAS.filter(
        (coluna) => !cabecalho.some((titulo) => chave(titulo) === chave(coluna))
    );

    if (faltando.length > 0) {
        throw new ErroValidacao('A planilha não tem o formato esperado.', {
            arquivo: `Colunas ausentes: ${faltando.join(', ')}.`,
        });
    }

    if (linhas.length === 0) {
        throw new ErroValidacao('A planilha não tem linhas de dados.', {
            arquivo: 'Nenhuma linha encontrada abaixo do cabeçalho.',
        });
    }

    return cubo.interpretar(linhas);
};

/**
 * Simula a carga: percorre todas as etapas e desfaz a transacao no final.
 * @param {Buffer} conteudo
 * @param {object} opcoes
 * @returns {Promise<object>} relatorio
 */
const simular = async (conteudo, opcoes = {}) =>
    executar(interpretarArquivo(conteudo), { ...opcoes, simular: true });

/**
 * Aplica a carga de verdade.
 * @param {Buffer} conteudo
 * @param {object} opcoes
 * @returns {Promise<object>} relatorio
 */
const aplicar = async (conteudo, opcoes = {}) =>
    executar(interpretarArquivo(conteudo), { ...opcoes, simular: false });

/**
 * Periodos letivos oferecidos no formulario.
 * @returns {Promise<object[]>}
 */
const periodosDisponiveis = () => importacaoRepository.listarPeriodos();

/**
 * Ultimas cargas realizadas.
 * @param {number} [limite]
 * @returns {Promise<object[]>}
 */
const historico = (limite) => importacaoRepository.listarImportacoes(limite);

module.exports = {
    simular,
    aplicar,
    interpretarArquivo,
    periodosDisponiveis,
    historico,
    nomeDoCampus,
};
