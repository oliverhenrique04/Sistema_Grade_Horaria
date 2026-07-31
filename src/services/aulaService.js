/**
 * Regras de negocio das aulas (grade horaria).
 *
 * Principios:
 *  - toda gravacao roda dentro de `db.transacao`, e os conflitos sao SEMPRE
 *    revalidados dentro da transacao (a pre-visualizacao nao e confiavel: outro
 *    usuario pode ter gravado no intervalo);
 *  - operacoes em lote usam UMA unica transacao - se um item conflitar, nada e
 *    gravado;
 *  - o objeto persistido e montado campo a campo a partir do validador; nada do
 *    `req.body` chega ao SQL sem passar por `validators/aula.js`;
 *  - a violacao do indice unico `ux_aula_turma_slot` (SQLSTATE 23505) e a rede
 *    de seguranca do banco e vira um `ErroConflito` legivel.
 */
const db = require('../config/db');
const aulaRepository = require('../repositories/aulaRepository');
const horarioTurnoRepository = require('../repositories/horarioTurnoRepository');
const conflitoService = require('./conflitoService');
const { DIAS, nomeDoDia } = require('../utils/dias');
const { faixaHoraria } = require('../utils/formatadores');
const { ErroConflito, ErroNaoEncontrado, ErroPermissao, ErroValidacao } = require('../utils/erros');
const {
    schemaAula,
    schemaMover,
    schemaCopiar,
    schemaFiltros,
    schemaLocalEmLote,
    validar,
} = require('../validators/aula');

/** Campos que o usuario pode alterar em uma aula. */
const CAMPOS_EDITAVEIS = [
    'turmaId',
    'disciplinaId',
    'professorId',
    'localId',
    'diaSemana',
    'horarioTurnoId',
    'modalidade',
    'observacao',
    'turmasAtendidas',
];

/** SQLSTATE de violacao de indice/constraint unica. */
const VIOLACAO_UNICIDADE = '23505';

/**
 * Conflitos que dependem do local da aula.
 *
 * `local` e a sala ocupada por outra turma no mesmo horario; `campus` e a sala
 * de outro campus. Choque de turma ou de professor nao muda quando se troca a
 * sala: sao problemas anteriores, tratados em outro lugar.
 */
const TIPOS_DE_CONFLITO_DE_LOCAL = new Set(['local', 'campus']);

/**
 * Converte a linha detalhada do banco no formato consumido pelas views da grade.
 * @param {object|null} linha
 * @returns {object|null}
 */
const paraCelula = (linha) => {
    if (!linha) return null;
    return {
        id: linha.id,
        disciplina_id: linha.disciplina_id,
        disciplina_nome: linha.disciplina_nome,
        disciplina_codigo: linha.disciplina_codigo,
        professor_id: linha.professor_id,
        professor_nome: linha.professor_nome,
        local_id: linha.local_id,
        local_nome: linha.local_nome,
        local_codigo: linha.local_codigo,
        local_tipo: linha.local_tipo,
        modalidade: linha.modalidade,
        observacao: linha.observacao,
        dia_semana: linha.dia_semana,
        horario_turno_id: linha.horario_turno_id,
        ativo: linha.ativo,
        total_professores: linha.total_professores || 0,
        outros_professores: linha.outros_professores || null,
        // Falso quando a turma apenas assiste a aula (disciplina compartilhada
        // registrada na turma gerencial): ela e exibida, mas nao editada aqui.
        propria: linha.propria !== false,
        // Turmas (e semestres) que cursam esta aula. Numa turma gerencial e o
        // que diz de qual semestre e a disciplina; nas demais vem vazio.
        turmas_atendidas: Array.isArray(linha.turmas_atendidas) ? linha.turmas_atendidas : [],
        faixa: faixaHoraria(linha.hora_inicio, linha.hora_fim),
    };
};

/**
 * Converte a aula do banco (colunas snake_case) para o formato do validador.
 * @param {object} aula
 * @returns {Record<string, any>}
 */
const paraEntrada = (aula) => ({
    turmaId: aula.turma_id,
    disciplinaId: aula.disciplina_id,
    professorId: aula.professor_id,
    localId: aula.local_id,
    diaSemana: aula.dia_semana,
    horarioTurnoId: aula.horario_turno_id,
    modalidade: aula.modalidade,
    observacao: aula.observacao,
    turmasAtendidas: (aula.turmas_atendidas || []).map((turma) => Number(turma.id)),
});

/**
 * Mescla os campos informados sobre uma base, ignorando qualquer chave que nao
 * seja editavel (protecao contra mass assignment).
 * @param {Record<string, any>} base
 * @param {Record<string, any>} novos
 * @returns {Record<string, any>}
 */
const mesclar = (base, novos = {}) => {
    const resultado = {};
    CAMPOS_EDITAVEIS.forEach((campo) => {
        resultado[campo] = Object.prototype.hasOwnProperty.call(novos, campo)
            ? novos[campo]
            : base[campo];
    });
    return resultado;
};

/**
 * Resumo textual usado como `message` do `ErroConflito`.
 * @param {import('./conflitoService').Conflito[]} conflitos
 * @returns {string}
 */
const resumoConflitos = (conflitos) =>
    conflitos.length === 1
        ? conflitos[0].mensagem
        : `${conflitos.length} conflitos impedem salvar esta aula.`;

/**
 * Lanca `ErroConflito` quando ha conflitos, com a lista completa em `detalhes`.
 * @param {import('./conflitoService').Conflito[]} conflitos
 */
const falharSeConflitar = (conflitos) => {
    if (conflitos.length > 0) {
        throw new ErroConflito(resumoConflitos(conflitos), conflitos);
    }
};

/**
 * Converte a violacao do indice unico da grade em um conflito legivel.
 * @param {Error & {code?:string, constraint?:string}} erro
 * @param {{diaSemana?:number}} [dados]
 * @returns {never}
 */
const traduzirErroDeBanco = (erro, dados = {}) => {
    if (erro && erro.code === VIOLACAO_UNICIDADE) {
        const dia = nomeDoDia(dados.diaSemana);
        const complemento = dia ? ` (${dia.toLowerCase()})` : '';
        throw new ErroConflito(
            `Esta turma já possui uma aula ativa neste dia e horário${complemento}.`,
            [
                {
                    tipo: 'turma',
                    mensagem: `Esta turma já possui uma aula ativa neste dia e horário${complemento}.`,
                    aulaId: null,
                },
            ]
        );
    }
    throw erro;
};

/**
 * Verifica se o usuario pode operar sobre a turma informada.
 *
 * `usuario` nulo significa uso interno (seed, scripts, testes) e nao restringe.
 * @param {{perfil?:string, cursosIds?:number[], campusIds?:number[]}|null} usuario
 * @param {{curso_id:number, campus_id:number}} turma
 */
const garantirPermissao = (usuario, turma) => {
    if (!usuario) return;
    if (usuario.perfil === 'admin') return;

    const cursos = (usuario.cursosIds || []).map(Number);
    const campi = (usuario.campusIds || []).map(Number);

    if (usuario.perfil === 'coordenador' && cursos.includes(Number(turma.curso_id))) return;
    if (usuario.perfil === 'nap' && campi.includes(Number(turma.campus_id))) return;

    throw new ErroPermissao('Você não tem permissão para alterar a grade desta turma.');
};

/**
 * Carrega a turma (com curso e campus) para a checagem de permissao.
 * @param {{query: Function}} executor
 * @param {number} turmaId
 * @returns {Promise<object>}
 */
const carregarTurma = async (executor, turmaId) => {
    const turma = await aulaRepository.resumoDaTurma(turmaId, executor);
    if (!turma) throw new ErroNaoEncontrado('Turma não encontrada.');
    return turma;
};

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/**
 * Aulas de uma turma, com disciplina, professor, local e horario resolvidos.
 * @param {number} turmaId
 * @param {{incluirInativas?:boolean}} [opcoes]
 * @returns {Promise<object[]>}
 */
const listarDaTurma = (turmaId, opcoes = {}) => aulaRepository.listarPorTurma(turmaId, opcoes);

/**
 * Monta a matriz da grade de uma turma, pronta para a view.
 *
 * `celulas` e um mapa `'<diaSemana>:<horarioTurnoId>' -> aula`, o que permite
 * lookup O(1) ao renderizar a tabela.
 *
 * @param {number} turmaId
 * @returns {Promise<{turma:object, horarios:object[], dias:object[],
 *                    celulas:Record<string,object>, pendentes:object[],
 *                    totais:{aulas:number, comLocal:number, semLocal:number,
 *                            semProfessor:number}}>}
 */
const montarMatriz = async (turmaId) => {
    const turma = await aulaRepository.resumoDaTurma(turmaId);
    if (!turma) throw new ErroNaoEncontrado('Turma não encontrada.');

    // `atendidas` descreve a composicao do grupo: as turmas que estudam juntas
    // nesta turma gerencial. Todas cursam todas as aulas dela — o agrupamento e o
    // que define a turma —, entao a lista e informativa, nao um filtro.
    const [horariosBrutos, atendidas, contagem, aulas] = await Promise.all([
        horarioTurnoRepository.listarPorTurno(turma.turno_id, { apenasAtivos: true }),
        aulaRepository.turmasAtendidasPor(turma.id),
        aulaRepository.contarPorTurma(turma.id),
        aulaRepository.listarPorTurma(turma.id),
    ]);

    const horarios = horariosBrutos.map((horario) => ({
        id: horario.id,
        nome: horario.nome,
        ordem: horario.ordem,
        hora_inicio: horario.hora_inicio,
        hora_fim: horario.hora_fim,
        ativo: horario.ativo,
        faixa: faixaHoraria(horario.hora_inicio, horario.hora_fim),
    }));

    // Uma celula pode ter mais de uma aula: turma gerencial oferta disciplinas
    // distintas no mesmo dia e horario, cada uma para um conjunto de turmas.
    // `celulas` guarda a lista completa; a primeira e a que a matriz destaca.
    const celulas = {};
    const pendentes = [];

    aulas.forEach((aula) => {
        const celula = paraCelula(aula);
        if (aula.horario_turno_id === null || aula.horario_turno_id === undefined) {
            pendentes.push(celula);
            return;
        }
        const chave = `${aula.dia_semana}:${aula.horario_turno_id}`;
        if (!celulas[chave]) celulas[chave] = [];
        celulas[chave].push(celula);
    });

    return {
        turma: {
            id: turma.id,
            nome: turma.nome,
            codigo: turma.codigo,
            semestre_curricular: turma.semestre_curricular,
            curso_id: turma.curso_id,
            curso_nome: turma.curso_nome,
            campus_id: turma.campus_id,
            campus_nome: turma.campus_nome,
            gerencial: turma.gerencial === true,
            turma_gerencial_id: turma.turma_gerencial_id || null,
            turno_id: turma.turno_id,
            turno_nome: turma.turno_nome,
            periodo_codigo: turma.periodo_codigo,
            ativo: turma.ativo,
        },
        horarios,
        dias: DIAS.map((dia) => ({
            valor: dia.valor,
            nome: dia.nome,
            curto: dia.curto,
            sigla: dia.sigla,
        })),
        celulas,
        pendentes,
        gerencial: turma.gerencial === true,
        atendidas,
        totais: {
            aulas: contagem.aulas,
            comLocal: contagem.comLocal,
            semLocal: contagem.semLocal,
            semProfessor: contagem.semProfessor,
        },
    };
};

/**
 * Aula detalhada pelo id.
 * @param {number} id
 * @returns {Promise<object>}
 * @throws {ErroNaoEncontrado}
 */
const obter = async (id) => {
    const aula = await aulaRepository.buscarPorId(id);
    if (!aula) throw new ErroNaoEncontrado('Aula não encontrada.');
    return aula;
};

/**
 * Listagem paginada de aulas com filtros ja validados.
 * @param {object} [filtros]
 * @returns {Promise<{itens:object[], total:number, filtros:object}>}
 */
const listar = async (filtros = {}) => {
    const limpos = validar(schemaFiltros, filtros, 'Filtros inválidos.');
    const [itens, total] = await Promise.all([
        aulaRepository.listar(limpos),
        aulaRepository.contar(limpos),
    ]);
    return { itens, total, filtros: limpos };
};

/**
 * Aulas pendentes: sem horario definido ou sem local definido.
 * @param {object} [filtros] aceita ainda `incluirProfessor` e `limite`
 * @returns {Promise<object[]>}
 */
const listarPendencias = async (filtros = {}) => {
    const limpos = validar(schemaFiltros, filtros, 'Filtros inválidos.');
    return aulaRepository.pendencias({
        ...limpos,
        incluirProfessor: filtros.incluirProfessor === true,
        limite: filtros.limite,
    });
};

/**
 * Pre-visualizacao de conflitos, sem gravar nada e sem transacao.
 *
 * Proposital: NAO aplica o schema completo. A pre-visualizacao acontece com o
 * formulario ainda pela metade (o usuario acabou de escolher o horario, mas nao
 * a disciplina) e precisa responder mesmo assim. `conflitoService` normaliza os
 * ids e ignora o que nao foi informado; a validacao definitiva acontece em
 * `criar`/`atualizar`, ja dentro da transacao.
 *
 * @param {object} dados
 * @param {{ignorarAulaId?:number|null}} [opcoes]
 * @returns {Promise<import('./conflitoService').Conflito[]>}
 */
const prevendoConflitos = async (dados, { ignorarAulaId = null } = {}) =>
    conflitoService.verificarConflitos(db, dados || {}, { ignorarAulaId });

// ---------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------

/**
 * Valida e grava uma aula dentro de uma transacao ja aberta.
 *
 * Usado por `criar`, `atualizar`, `mover`, `copiar`, `reativar` e `criarEmLote`:
 * toda a validacao mora aqui, nenhuma delas duplica regra.
 *
 * @param {import('pg').PoolClient} cliente
 * @param {object} entrada dados brutos (serao validados)
 * @param {{aulaId?:number|null, usuario?:object|null, ativo?:boolean}} opcoes
 * @returns {Promise<object>} aula detalhada
 */
const gravar = async (cliente, entrada, { aulaId = null, usuario = null, ativo = true } = {}) => {
    const dados = validar(schemaAula, entrada);

    const turma = await carregarTurma(cliente, dados.turmaId);
    garantirPermissao(usuario, turma);

    // Aula inativa nao ocupa slot nenhum: pode ser editada livremente. Conflitos
    // sao revalidados quando ela voltar a ficar ativa (`reativar`).
    if (ativo !== false) {
        const conflitos = await conflitoService.verificarConflitos(cliente, dados, {
            ignorarAulaId: aulaId,
            bloquear: true,
        });
        falharSeConflitar(conflitos);
    }

    const persistir = { ...dados, ativo };

    try {
        const linha = aulaId
            ? await aulaRepository.atualizar(aulaId, persistir, cliente)
            : await aulaRepository.inserir(persistir, cliente);

        if (!linha) throw new ErroNaoEncontrado('Aula não encontrada.');

        // Turmas que cursam a aula. Vale para turma gerencial; nas demais a
        // lista chega vazia e o vinculo simplesmente nao existe.
        await aulaRepository.definirTurmasAtendidas(
            linha.id,
            dados.turmasAtendidas === undefined ? null : dados.turmasAtendidas,
            cliente
        );

        return await aulaRepository.buscarPorId(linha.id, cliente);
    } catch (erro) {
        return traduzirErroDeBanco(erro, dados);
    }
};

/**
 * Cria uma aula.
 * @param {object} dados
 * @param {object|null} [usuario]
 * @returns {Promise<object>} aula detalhada
 * @throws {ErroConflito} com `detalhes` = Conflito[]
 */
const criar = async (dados, usuario = null) =>
    db.transacao(async (cliente) => {
        await aulaRepository.travarGrade(cliente);
        return gravar(cliente, dados, { usuario });
    });

/**
 * Atualiza uma aula existente. Campos ausentes em `dados` mantem o valor atual.
 * @param {number} id
 * @param {object} dados
 * @param {object|null} [usuario]
 * @returns {Promise<object>}
 */
const atualizar = async (id, dados, usuario = null) =>
    db.transacao(async (cliente) => {
        await aulaRepository.travarGrade(cliente);

        const atual = await aulaRepository.buscarPorId(id, cliente, { bloquear: true });
        if (!atual) throw new ErroNaoEncontrado('Aula não encontrada.');

        const entrada = mesclar(paraEntrada(atual), dados);

        return gravar(cliente, entrada, { aulaId: atual.id, usuario, ativo: atual.ativo });
    });

/**
 * Move a aula para outro dia/horario reutilizando toda a validacao de `gravar`.
 * @param {number} id
 * @param {{diaSemana:number, horarioTurnoId:number|null}} destino
 * @param {object|null} [usuario]
 * @returns {Promise<object>}
 */
const mover = async (id, destino, usuario = null) => {
    const alvo = validar(schemaMover, destino, 'Destino inválido para mover a aula.');
    return atualizar(id, alvo, usuario);
};

/**
 * Copia a aula para outro dia/horario (e, opcionalmente, para outra turma).
 * @param {number} id
 * @param {{diaSemana:number, horarioTurnoId:number|null, turmaId?:number|null}} destino
 * @param {object|null} [usuario]
 * @returns {Promise<object>} a NOVA aula
 */
const copiar = async (id, destino, usuario = null) => {
    const alvo = validar(schemaCopiar, destino, 'Destino inválido para copiar a aula.');

    return db.transacao(async (cliente) => {
        await aulaRepository.travarGrade(cliente);

        const origem = await aulaRepository.buscarPorId(id, cliente);
        if (!origem) throw new ErroNaoEncontrado('Aula não encontrada.');

        const entrada = mesclar(paraEntrada(origem), {
            diaSemana: alvo.diaSemana,
            horarioTurnoId: alvo.horarioTurnoId,
            ...(alvo.turmaId ? { turmaId: alvo.turmaId } : {}),
        });

        return gravar(cliente, entrada, { usuario });
    });
};

/**
 * Inativa a aula preservando o historico (nao apaga o registro).
 * @param {number} id
 * @param {object|null} [usuario]
 * @returns {Promise<void>}
 */
const inativar = async (id, usuario = null) =>
    db.transacao(async (cliente) => {
        const atual = await aulaRepository.buscarPorId(id, cliente, { bloquear: true });
        if (!atual) throw new ErroNaoEncontrado('Aula não encontrada.');

        const turma = await carregarTurma(cliente, atual.turma_id);
        garantirPermissao(usuario, turma);

        await aulaRepository.definirAtivo(atual.id, false, cliente);
    });

/**
 * Reativa a aula. Revalida os conflitos: o slot pode ter sido ocupado enquanto
 * a aula estava inativa.
 * @param {number} id
 * @param {object|null} [usuario]
 * @returns {Promise<void>}
 */
const reativar = async (id, usuario = null) =>
    db.transacao(async (cliente) => {
        await aulaRepository.travarGrade(cliente);

        const atual = await aulaRepository.buscarPorId(id, cliente, { bloquear: true });
        if (!atual) throw new ErroNaoEncontrado('Aula não encontrada.');

        await gravar(cliente, paraEntrada(atual), {
            aulaId: atual.id,
            usuario,
            ativo: true,
        });
    });

/**
 * Exclusao real da aula. Use apenas quando o historico nao importa; o caminho
 * recomendado e `inativar`.
 * @param {number} id
 * @param {object|null} [usuario]
 * @returns {Promise<void>}
 */
const remover = async (id, usuario = null) =>
    db.transacao(async (cliente) => {
        const atual = await aulaRepository.buscarPorId(id, cliente, { bloquear: true });
        if (!atual) throw new ErroNaoEncontrado('Aula não encontrada.');

        const turma = await carregarTurma(cliente, atual.turma_id);
        garantirPermissao(usuario, turma);

        await aulaRepository.excluir(atual.id, cliente);
    });

/**
 * Cria varias aulas em UMA unica transacao (copiar semana, importar grade...).
 *
 * Se qualquer item conflitar, NADA e gravado: a transacao inteira sofre
 * rollback e a lista de conflitos volta com o indice do item que falhou.
 *
 * @param {object[]} listaDeDados
 * @param {object|null} [usuario]
 * @returns {Promise<{criadas:object[], conflitos:Array<import('./conflitoService').Conflito & {indice:number}>}>}
 */
const criarEmLote = async (listaDeDados, usuario = null) => {
    const itens = Array.isArray(listaDeDados) ? listaDeDados : [];

    if (itens.length === 0) {
        throw new ErroValidacao('Informe ao menos uma aula para criar.', {
            aulas: 'Nenhuma aula informada.',
        });
    }

    /** Sinalizador interno usado apenas para forcar o ROLLBACK da transacao. */
    const abortar = Symbol('conflitos-em-lote');

    try {
        const criadas = await db.transacao(async (cliente) => {
            await aulaRepository.travarGrade(cliente);

            const gravadas = [];
            const problemas = [];

            for (let indice = 0; indice < itens.length; indice += 1) {
                try {
                    // Sequencial de proposito: todos os itens compartilham a
                    // mesma transacao e cada um precisa enxergar os anteriores.
                    const aula = await gravar(cliente, itens[indice], { usuario });
                    gravadas.push(aula);
                } catch (erro) {
                    if (erro instanceof ErroConflito) {
                        const detalhes = Array.isArray(erro.detalhes)
                            ? erro.detalhes
                            : [{ tipo: 'turma', mensagem: erro.message, aulaId: null }];
                        problemas.push(...detalhes.map((item) => ({ ...item, indice })));
                        // Interrompe: a transacao ja precisa ser desfeita.
                        break;
                    }
                    throw erro;
                }
            }

            if (problemas.length > 0) {
                const erro = new Error('Conflitos no lote.');
                erro[abortar] = problemas;
                throw erro;
            }

            return gravadas;
        });

        return { criadas, conflitos: [] };
    } catch (erro) {
        if (erro && erro[abortar]) {
            return { criadas: [], conflitos: erro[abortar] };
        }
        throw erro;
    }
};

/**
 * Aplica o mesmo local a varias aulas de uma turma de uma vez.
 *
 * Existe porque a carga do TOTVS nao traz sala: uma turma chega com dezenas de
 * aulas sem local, e aloca-las uma a uma nao e trabalho que alguem faca.
 *
 * COMPORTAMENTO DIFERENTE DE `criarEmLote`, DE PROPOSITO: ali um conflito
 * cancela o lote inteiro, porque criar meia grade seria pior do que nao criar.
 * Aqui a operacao preenche um campo operacional em aulas que ja existem, e
 * travar as vinte por causa de duas seria trocar um problema pequeno por um
 * grande. As aulas que conflitam ficam como estavam e voltam na resposta, com o
 * motivo, para o operador resolver caso a caso.
 *
 * @param {number} turmaId
 * @param {{localId:number|null, disciplinas?:number[], dias?:number[],
 *          horarios?:number[], apenasSemLocal?:boolean}} escolha lista vazia em
 *        qualquer eixo significa "todos".
 * @param {object|null} [usuario]
 * @returns {Promise<{alteradas:number, ignoradas:number, recusadas:Array<{aulaId:number,
 *          disciplina:string, motivo:string}>, total:number}>}
 */
const definirLocalEmLote = async (turmaId, escolha, usuario = null) => {
    const dados = validar(schemaLocalEmLote, escolha, 'Não foi possível aplicar o local.');

    return db.transacao(async (cliente) => {
        await aulaRepository.travarGrade(cliente);

        const turma = await carregarTurma(cliente, turmaId);
        garantirPermissao(usuario, turma);

        // Tres eixos independentes de recorte — disciplina, dia e horario. Lista
        // vazia em qualquer um deles significa "todos", entao quem nao filtra
        // nada alcanca a turma inteira.
        const disciplinas = new Set(dados.disciplinas.map(Number));
        const dias = new Set(dados.dias.map(Number));
        const horarios = new Set(dados.horarios.map(Number));

        const aulas = (await aulaRepository.listarPorTurma(turma.id, {}, cliente)).filter(
            (aula) =>
                aula.ativo &&
                // Aula herdada pertence a turma que a oferta: alterar aqui
                // mudaria a alocacao de todas as outras turmas do grupo.
                aula.propria !== false &&
                (!dados.apenasSemLocal || aula.local_id === null) &&
                (disciplinas.size === 0 || disciplinas.has(Number(aula.disciplina_id))) &&
                (dias.size === 0 || dias.has(Number(aula.dia_semana))) &&
                (horarios.size === 0 || horarios.has(Number(aula.horario_turno_id)))
        );

        // Local invalido invalida a operacao inteira: nao faz sentido percorrer
        // trinta aulas para recusar todas pelo mesmo motivo.
        if (dados.localId !== null) {
            const contexto = await aulaRepository.contextoDaAula(
                { turmaId: turma.id, localId: dados.localId },
                cliente
            );

            if (!contexto.local_id) {
                throw new ErroValidacao('Local não encontrado.', {
                    localId: 'Selecione um local existente.',
                });
            }

            if (contexto.local_ativo === false) {
                throw new ErroValidacao('Local inativo.', {
                    localId: `O local "${contexto.local_nome}" está desativado.`,
                });
            }

            // Ambiente virtual (EAD) e compartilhado entre campus; os demais
            // precisam ser do campus da turma.
            if (
                contexto.local_tipo !== 'virtual' &&
                Number(contexto.local_campus_id) !== Number(turma.campus_id)
            ) {
                throw new ErroValidacao('Local de outro campus.', {
                    localId: `"${contexto.local_nome}" pertence a outro campus; a turma é de ${turma.campus_nome}.`,
                });
            }
        }

        const recusadas = [];
        let alteradas = 0;

        for (const aula of aulas) {
            if (Number(aula.local_id) === dados.localId) continue;

            const entrada = mesclar(paraEntrada(aula), { localId: dados.localId });

            // Sequencial: cada aula precisa enxergar as anteriores para que duas
            // aulas simultaneas nao recebam a mesma sala nesta mesma passada.
            const todos = await conflitoService.verificarConflitos(cliente, entrada, {
                ignorarAulaId: aula.id,
                bloquear: true,
            });

            // SO os conflitos que a troca de local pode causar. A grade
            // importada tem choques de turma e de professor que ja existiam
            // antes — barrar a alocacao por causa deles deixaria a sala vazia
            // sem que o operador pudesse fazer nada a respeito daqui.
            const conflitos = todos.filter((item) => TIPOS_DE_CONFLITO_DE_LOCAL.has(item.tipo));

            if (conflitos.length > 0) {
                recusadas.push({
                    aulaId: aula.id,
                    disciplina: aula.disciplina_nome,
                    dia: aula.dia_semana,
                    faixa: faixaHoraria(aula.hora_inicio, aula.hora_fim),
                    motivo: conflitos[0].mensagem,
                });
                continue;
            }

            await aulaRepository.definirLocal(aula.id, dados.localId, cliente);
            alteradas += 1;
        }

        return {
            total: aulas.length,
            alteradas,
            ignoradas: aulas.length - alteradas - recusadas.length,
            recusadas,
        };
    });
};

module.exports = {
    definirLocalEmLote,
    listarDaTurma,
    montarMatriz,
    obter,
    listar,
    criar,
    atualizar,
    mover,
    copiar,
    inativar,
    reativar,
    remover,
    criarEmLote,
    prevendoConflitos,
    listarPendencias,
    paraCelula,
};
