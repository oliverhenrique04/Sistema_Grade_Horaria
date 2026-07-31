/**
 * Montador da grade horaria e listagem de aulas.
 *
 * Responsabilidades deste controller (e apenas estas):
 *  - ler a requisicao, montar os dados CAMPO A CAMPO e delegar ao
 *    `aulaService` (nenhum spread de `req.body` chega ao service);
 *  - decidir o que renderizar: matriz, formulario reexibido com os conflitos ou
 *    POST-Redirect-GET com mensagem flash;
 *  - aplicar as restricoes que dependem do registro alvo: escopo de curso/campus
 *    (`garantirAcessoTurma`) e os campos que cada perfil pode alterar.
 *
 * Regras de perfil aplicadas AQUI (a matriz de permissoes cuida do resto):
 *  - `nap` altera somente local e modalidade e nao pode criar, mover, copiar,
 *    inativar nem remover — a lista de campos e montada explicitamente, entao
 *    um `disciplina_id` enviado no formulario simplesmente nao existe para o
 *    service;
 *  - `coordenador` so opera turmas dos cursos vinculados.
 *
 * Tudo funciona sem JavaScript: os formularios fazem POST normal, o servidor
 * responde com redirecionamento (acoes rapidas) ou reexibe o formulario
 * preenchido com os conflitos (gravacoes com formulario).
 */
const aulaService = require('../../services/aulaService');
const turmaService = require('../../services/turmaService');
const aulaRepository = require('../../repositories/aulaRepository');
const disciplinaRepository = require('../../repositories/disciplinaRepository');
const professorRepository = require('../../repositories/professorRepository');
const localRepository = require('../../repositories/localRepository');
const { schemaFiltros, validar } = require('../../validators/aula');
const { garantirAcessoTurma } = require('../../middlewares/autorizacao');
const { destinoInternoSeguro } = require('../../middlewares/contexto');
const paginacaoUtil = require('../../utils/paginacao');
const { DIAS, PRIMEIRO_DIA, ULTIMO_DIA } = require('../../utils/dias');
const { MODALIDADES, plural } = require('../../utils/formatadores');
const {
    ErroValidacao,
    ErroConflito,
    ErroPermissao,
    ErroNaoEncontrado,
    async: assincrono,
} = require('../../utils/erros');

const MENU = 'aulas';
const BASE = '/admin/aulas';

/** Teto das listas usadas em `<select>` (disciplinas, professores, locais). */
const LIMITE_OPCOES = 500;

/** Acoes que o montador aceita pela query string. */
const ACOES = ['nova', 'editar', 'mover', 'copiar'];

const VALORES_MODALIDADE = MODALIDADES.map((item) => item.valor);

// ---------------------------------------------------------------------------
// Leitura de parametros
// ---------------------------------------------------------------------------

/** Inteiro positivo ou `null` (aceita string de formulario). */
const idOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
};

/** Texto aparado, sempre string. */
const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/** Marcador de checkbox/filtro booleano ("1", "on", "true", "sim"). */
const marcado = (valor) => ['1', 'on', 'true', 'sim'].includes(String(valor || '').toLowerCase());

/** Dia da semana valido (1..6) ou `null`. */
const diaOuNulo = (valor) => {
    const dia = idOuNulo(valor);
    return dia !== null && dia >= PRIMEIRO_DIA && dia <= ULTIMO_DIA ? dia : null;
};

/** Modalidade conhecida ou `null`. */
const modalidadeOuNula = (valor) => {
    const bruta = texto(valor);
    return VALORES_MODALIDADE.includes(bruta) ? bruta : null;
};

/** Situacao em tres estados: `true`, `false` ou `null` (todos). */
const situacaoOuNula = (valor) => {
    const bruta = texto(valor);
    if (bruta === '') return null;
    if (['1', 'true', 'ativo', 'ativos'].includes(bruta.toLowerCase())) return true;
    if (['0', 'false', 'inativo', 'inativos'].includes(bruta.toLowerCase())) return false;
    return null;
};

/**
 * Lista de ids vinda de checkboxes repetidos (`horario_turno_ids`).
 * O parser de formularios entrega string quando ha um unico valor marcado.
 * @param {any} valor
 * @returns {number[]} ids unicos, na ordem em que chegaram
 */
const listaDeIds = (valor) => {
    const bruto = Array.isArray(valor) ? valor : [valor];
    const ids = [];
    bruto.forEach((item) => {
        const id = idOuNulo(item);
        if (id !== null && !ids.includes(id)) ids.push(id);
    });
    return ids;
};

/** Erros de dominio que o formulario sabe exibir sem sair da tela. */
const ehErroDeFormulario = (erro) => erro instanceof ErroValidacao || erro instanceof ErroConflito;

/**
 * Lista de conflitos legivel a partir de um `ErroConflito`.
 * @param {Error} erro
 * @returns {import('../../services/conflitoService').Conflito[]}
 */
const conflitosDoErro = (erro) => {
    if (!(erro instanceof ErroConflito)) return [];
    if (Array.isArray(erro.detalhes) && erro.detalhes.length > 0) return erro.detalhes;
    return [{ tipo: 'turma', mensagem: erro.message, aulaId: null }];
};

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

const ehNap = (usuario) => Boolean(usuario) && usuario.perfil === 'nap';

/**
 * Garante que o perfil pode estruturar a grade (criar, mover, copiar, remover).
 * O NAP tem permissao de "editar" na matriz, mas apenas para ajustar a alocacao
 * operacional; sem esta checagem ele conseguiria mover uma aula.
 * @param {object} usuario
 * @param {string} acao texto usado na mensagem ("mover aulas")
 * @throws {ErroPermissao}
 */
const garantirEstruturacao = (usuario, acao) => {
    if (!ehNap(usuario)) return;
    throw new ErroPermissao(
        `Seu perfil pode apenas ajustar o local e a modalidade das aulas: não é possível ${acao}.`
    );
};

/**
 * Dados de uma NOVA aula, campo a campo (protecao contra mass assignment).
 * @param {Record<string, any>} corpo
 * @param {number} turmaId
 * @returns {Record<string, any>} entrada para `aulaService`
 */
const dadosParaCriacao = (corpo = {}, turmaId) => ({
    turmaId,
    disciplinaId: corpo.disciplina_id,
    professorId: corpo.professor_id,
    localId: corpo.local_id,
    diaSemana: corpo.dia_semana,
    horarioTurnoId: corpo.horario_turno_id,
    modalidade: corpo.modalidade,
    observacao: corpo.observacao,
    turmasAtendidas: corpo.turmas_atendidas,
});

/**
 * Campos que ESTE usuario pode alterar nesta aula.
 *
 * A lista e montada campo a campo: o que nao entrar aqui nao chega ao service e,
 * como `aulaService.atualizar` mescla os campos ausentes com os valores atuais,
 * o registro permanece intacto. E assim que a restricao do NAP e garantida no
 * backend (esconder o campo na view seria apenas conforto visual).
 *
 * @param {object} usuario
 * @param {Record<string, any>} corpo
 * @returns {Record<string, any>}
 */
const camposParaAtualizacao = (usuario, corpo = {}) => {
    const enviado = (campo) => Object.prototype.hasOwnProperty.call(corpo, campo);
    const dados = {};

    // Alocacao operacional: liberada para todos os perfis que editam aulas.
    if (enviado('local_id')) dados.localId = corpo.local_id;
    if (enviado('modalidade')) dados.modalidade = corpo.modalidade;

    if (ehNap(usuario)) return dados;

    if (enviado('disciplina_id')) dados.disciplinaId = corpo.disciplina_id;
    if (enviado('professor_id')) dados.professorId = corpo.professor_id;
    if (enviado('dia_semana')) dados.diaSemana = corpo.dia_semana;
    if (enviado('horario_turno_id')) dados.horarioTurnoId = corpo.horario_turno_id;
    if (enviado('observacao')) dados.observacao = corpo.observacao;
    if (enviado('turmas_atendidas')) dados.turmasAtendidas = corpo.turmas_atendidas;
    // Formulario de turma gerencial sempre envia o marcador; nenhuma caixa
    // marcada significa "nenhuma turma", nao "manter como estava".
    else if (enviado('turmas_atendidas_enviado')) dados.turmasAtendidas = [];

    return dados;
};

// ---------------------------------------------------------------------------
// Valores do formulario
// ---------------------------------------------------------------------------

/**
 * Valores reconstruidos a partir do que o usuario preencheu (reexibicao apos
 * erro: nada do que ele digitou se perde).
 * @param {Record<string, any>} corpo
 */
const valoresDoCorpo = (corpo = {}) => ({
    aula_id: texto(corpo.aula_id),
    turma_id: texto(corpo.turma_id),
    disciplina_id: texto(corpo.disciplina_id),
    professor_id: texto(corpo.professor_id),
    local_id: texto(corpo.local_id),
    dia_semana: texto(corpo.dia_semana),
    horario_turno_id: texto(corpo.horario_turno_id),
    modalidade: texto(corpo.modalidade) || 'presencial',
    observacao: typeof corpo.observacao === 'string' ? corpo.observacao : '',
    horarios: listaDeIds(corpo.horario_turno_ids),
    turmas_atendidas: listaDeIds(corpo.turmas_atendidas),
});

/**
 * Valores do formulario a partir de uma aula ja gravada.
 * @param {object} aula linha detalhada de `aulaRepository`
 */
const valoresDaAula = (aula) => ({
    aula_id: String(aula.id),
    turma_id: String(aula.turma_id),
    disciplina_id: aula.disciplina_id === null ? '' : String(aula.disciplina_id),
    professor_id: aula.professor_id === null ? '' : String(aula.professor_id),
    local_id: aula.local_id === null ? '' : String(aula.local_id),
    dia_semana: aula.dia_semana === null ? '' : String(aula.dia_semana),
    horario_turno_id: aula.horario_turno_id === null ? '' : String(aula.horario_turno_id),
    modalidade: aula.modalidade || 'presencial',
    observacao: aula.observacao || '',
    horarios: aula.horario_turno_id ? [aula.horario_turno_id] : [],
    turmas_atendidas: (aula.turmas_atendidas || []).map((turma) => Number(turma.id)),
});

/** Valores de uma celula vazia recem-clicada. */
const valoresDaCelula = (turmaId, diaSemana, horarioTurnoId) => ({
    aula_id: '',
    turma_id: String(turmaId),
    disciplina_id: '',
    professor_id: '',
    local_id: '',
    dia_semana: diaSemana === null ? '' : String(diaSemana),
    horario_turno_id: horarioTurnoId === null ? '' : String(horarioTurnoId),
    modalidade: 'presencial',
    observacao: '',
    horarios: horarioTurnoId === null ? [] : [horarioTurnoId],
    turmas_atendidas: [],
});

// ---------------------------------------------------------------------------
// Opcoes dos selects
// ---------------------------------------------------------------------------

const porNome = (a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');

/** Remove repetidos por id preservando a primeira ocorrencia. */
const unicosPorId = (lista) => {
    const vistos = new Set();
    return lista.filter((item) => {
        const chave = Number(item.id);
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
    });
};

/**
 * Garante que o valor ja gravado na aula apareca no select, mesmo quando ele
 * esta inativo ou fora do campus (senao o formulario perderia a selecao).
 */
const comValorAtual = (lista, id, item) => {
    if (!id) return lista;
    if (lista.some((opcao) => Number(opcao.id) === Number(id))) return lista;
    return [...lista, item].sort(porNome);
};

/**
 * Opcoes de disciplina, professor e local para o formulario da aula.
 * @param {{campus_id:number}} turma
 * @param {object|null} aula aula em edicao, para preservar valores inativos
 */
const carregarOpcoes = async (turma, aula = null) => {
    const [disciplinas, professores, locaisDoCampus, locaisVirtuais, turmasAtendidas] =
        await Promise.all([
            disciplinaRepository.listar({ status: true }, { limite: LIMITE_OPCOES, offset: 0 }),
            professorRepository.listar({ status: true }, { limite: LIMITE_OPCOES, offset: 0 }),
            localRepository.listar({
                ativo: true,
                campusId: turma.campus_id,
                limite: LIMITE_OPCOES,
            }),
            // Locais virtuais (EAD) sao compartilhados entre campus: o conflitoService
            // abre excecao para eles, entao tambem entram na lista.
            localRepository.listar({ ativo: true, tipo: 'virtual', limite: LIMITE_OPCOES }),
            // Turmas que a gerencial atende: sao as opcoes de "quem cursa esta
            // disciplina". Vazio nas turmas comuns.
            turma.gerencial ? aulaRepository.turmasCandidatasDaGerencial(turma.id) : [],
        ]);

    const locais = unicosPorId([...locaisDoCampus, ...locaisVirtuais]).sort(porNome);

    if (!aula) return { disciplinas, professores, locais, turmasAtendidas };

    return {
        turmasAtendidas,
        disciplinas: comValorAtual(disciplinas, aula.disciplina_id, {
            id: aula.disciplina_id,
            nome: aula.disciplina_nome,
            codigo: aula.disciplina_codigo,
            ativo: aula.disciplina_ativa,
        }),
        professores: comValorAtual(professores, aula.professor_id, {
            id: aula.professor_id,
            nome: aula.professor_nome,
            ativo: aula.professor_ativo,
        }),
        locais: comValorAtual(locais, aula.local_id, {
            id: aula.local_id,
            nome: aula.local_nome,
            codigo: aula.local_codigo,
            tipo: aula.local_tipo,
            ativo: aula.local_ativo,
        }),
    };
};

// ---------------------------------------------------------------------------
// URLs e redirecionamentos
// ---------------------------------------------------------------------------

/** URL do montador de uma turma, com parametros opcionais. */
const urlMontador = (req, turmaId, parametros = {}) =>
    req.withBase(`${BASE}/turma/${turmaId}${paginacaoUtil.queryString({}, parametros)}`);

/**
 * Destino do POST-Redirect-GET: usa o campo `voltar` quando ele aponta para um
 * caminho interno (evita open redirect) e cai no montador da turma.
 */
const destinoDeRetorno = (req, turmaId) =>
    destinoInternoSeguro(req.body.voltar, urlMontador(req, turmaId), req.basePath);

/** Requisicao que espera JSON (fetch do montador). */
const querJson = (req) =>
    req.xhr ||
    String(req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest' ||
    String(req.get('accept') || '').includes('application/json') ||
    texto(req.body && req.body.formato) === 'json';

// ---------------------------------------------------------------------------
// Renderizacao do montador
// ---------------------------------------------------------------------------

/**
 * Renderiza a matriz da turma.
 *
 * Usada tanto pelo GET quanto pelos POSTs que precisam reexibir o formulario
 * com os conflitos, por isso recebe todo o estado da tela por parametro.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{turmaId:number, status?:number, acao?:string|null,
 *          aulaSelecionada?:object|null, valores?:object|null,
 *          erros?:Record<string,string>, conflitos?:object[],
 *          mensagemErro?:string|null, previsao?:boolean}} opcoes
 */
const renderizarMontador = async (
    req,
    res,
    {
        turmaId,
        status = 200,
        acao = null,
        aulaSelecionada = null,
        valores = null,
        erros = {},
        conflitos = [],
        mensagemErro = null,
        previsao = false,
    }
) => {
    const matriz = await aulaService.montarMatriz(turmaId);
    const opcoes = await carregarOpcoes(matriz.turma, aulaSelecionada);

    const diaVisivel = diaOuNulo(req.query.dia);
    const naoEstrutura = ehNap(req.usuario);

    res.status(status).render('admin/aulas/montador', {
        tituloPagina: `Grade de ${matriz.turma.nome}`,
        subtitulo: `${matriz.turma.curso_nome} · ${matriz.turma.campus_nome} · ${matriz.turma.turno_nome} · ${matriz.turma.periodo_codigo}`,
        menuAtivo: MENU,
        breadcrumbs: [
            { texto: 'Painel', url: '/admin' },
            { texto: 'Aulas', url: BASE },
            { texto: 'Turmas', url: `${BASE}/turma` },
            { texto: matriz.turma.nome },
        ],
        scriptsExtras: ['/js/montador.js'],

        turma: matriz.turma,
        horarios: matriz.horarios,
        dias: matriz.dias,
        celulas: matriz.celulas,
        pendentes: matriz.pendentes,
        totais: matriz.totais,
        atendidas: matriz.atendidas,

        opcoes,
        modalidades: MODALIDADES,

        acao,
        aulaSelecionada,
        valores: valores || valoresDaCelula(matriz.turma.id, null, null),
        erros,
        conflitos,
        mensagemErro,
        previsao,

        diaVisivel,
        somenteAlocacao: naoEstrutura,
        urlBaseMontador: urlMontador(req, matriz.turma.id),
        voltar: req.originalUrl,
    });
};

/**
 * Estado inicial do formulario a partir da query string
 * (`?acao=nova&dia_semana=1&horario_turno_id=7` ou `?acao=editar&aula=12`).
 * @param {import('express').Request} req
 * @param {number} turmaId
 */
const estadoDaQuery = async (req, turmaId) => {
    const acao = ACOES.includes(texto(req.query.acao)) ? texto(req.query.acao) : null;
    if (!acao) return { acao: null, aulaSelecionada: null, valores: null };

    if (acao === 'nova') {
        return {
            acao,
            aulaSelecionada: null,
            valores: valoresDaCelula(
                turmaId,
                diaOuNulo(req.query.dia_semana),
                idOuNulo(req.query.horario_turno_id)
            ),
        };
    }

    const aulaId = idOuNulo(req.query.aula);
    if (aulaId === null) return { acao: null, aulaSelecionada: null, valores: null };

    const aula = await aulaService.obter(aulaId);
    // Aula de outra turma nao abre formulario nesta matriz.
    if (Number(aula.turma_id) !== Number(turmaId)) {
        return { acao: null, aulaSelecionada: null, valores: null };
    }

    return { acao, aulaSelecionada: aula, valores: valoresDaAula(aula) };
};

// ---------------------------------------------------------------------------
// Handlers de consulta
// ---------------------------------------------------------------------------

/**
 * GET /admin/aulas/turma/:turmaId — o montador.
 * @type {import('express').RequestHandler}
 */
const montador = assincrono(async (req, res) => {
    const turmaId = idOuNulo(req.params.turmaId);
    if (turmaId === null) throw new ErroNaoEncontrado('Turma não encontrada.');

    await garantirAcessoTurma(req.usuario, turmaId);

    const estado = await estadoDaQuery(req, turmaId);
    await renderizarMontador(req, res, { turmaId, ...estado });
});

/**
 * GET /admin/aulas/turma — escolha da turma quando nenhuma foi informada.
 * @type {import('express').RequestHandler}
 */
const selecionarTurma = assincrono(async (req, res) => {
    const { pagina, porPagina } = paginacaoUtil.lerParametros(req.query);

    const filtros = {
        busca: texto(req.query.busca) || null,
        periodoLetivoId: idOuNulo(req.query.periodo_id),
        campusId: idOuNulo(req.query.campus_id),
        cursoId: idOuNulo(req.query.curso_id),
        turnoId: idOuNulo(req.query.turno_id),
        ativo: situacaoOuNula(req.query.ativo === undefined ? '1' : req.query.ativo),
        // Esta tela existe para escolher onde montar grade: por padrao, esconde
        // as turmas que apenas recebem disciplinas de uma gerencial.
        exibicao: req.query.exibicao === 'todas' ? 'todas' : 'grade',
    };

    const [{ itens, paginacao, integradasOcultas }, opcoes] = await Promise.all([
        turmaService.listar(req.usuario, { ...filtros, pagina, porPagina }),
        turmaService.opcoesFiltros(req.usuario),
    ]);

    res.render('admin/aulas/selecionar-turma', {
        tituloPagina: 'Montar grade',
        subtitulo: 'Escolha a turma para abrir o montador',
        menuAtivo: MENU,
        breadcrumbs: [
            { texto: 'Painel', url: '/admin' },
            { texto: 'Aulas', url: BASE },
            { texto: 'Turmas' },
        ],
        itens,
        paginacao,
        integradasOcultas,
        opcoes,
        urlComFiltros: (sobrescrever) =>
            req.withBase(
                `${BASE}/turma${paginacaoUtil.queryString(req.query, { pagina: '', ...sobrescrever })}`
            ),
        filtros: {
            exibicao: filtros.exibicao,
            busca: texto(req.query.busca),
            periodo_id: filtros.periodoLetivoId === null ? '' : String(filtros.periodoLetivoId),
            campus_id: filtros.campusId === null ? '' : String(filtros.campusId),
            curso_id: filtros.cursoId === null ? '' : String(filtros.cursoId),
            turno_id: filtros.turnoId === null ? '' : String(filtros.turnoId),
            ativo: filtros.ativo === null ? '' : String(filtros.ativo ? 1 : 0),
        },
        urlBase: (numero) =>
            req.withBase(
                `${BASE}/turma${paginacaoUtil.queryString(req.query, { pagina: numero })}`
            ),
    });
});

/**
 * Restringe a consulta ao escopo do usuario.
 * Coordenador enxerga os cursos vinculados; NAP, os campus vinculados. Escopo
 * vazio devolve lista vazia, o que e o comportamento correto (nao e erro).
 * @param {object} usuario
 */
const escopoDaConsulta = (usuario) => {
    if (!usuario || usuario.perfil === 'admin') return {};
    if (usuario.perfil === 'coordenador') return { cursosIds: usuario.cursosIds || [] };
    if (usuario.perfil === 'nap') return { campusIds: usuario.campusIds || [] };
    return { cursosIds: [], campusIds: [] };
};

/**
 * GET /admin/aulas — listagem com filtros, busca e paginacao.
 *
 * A consulta usa `aulaRepository` diretamente porque dois criterios desta tela
 * nao existem em `schemaFiltros` (e portanto nao passam por `aulaService.listar`):
 * o escopo do usuario (`cursosIds`/`campusIds`) e os marcadores de pendencia
 * (`semHorario`/`semLocal`). Nenhum SQL mora aqui: os filtros validados sao
 * apenas repassados ao repository.
 *
 * @type {import('express').RequestHandler}
 */
const lista = assincrono(async (req, res) => {
    const { pagina, porPagina } = paginacaoUtil.lerParametros(req.query);

    const semHorario = marcado(req.query.sem_horario);
    const semLocal = marcado(req.query.sem_local);

    const filtros = validar(
        schemaFiltros,
        {
            turmaId: idOuNulo(req.query.turma_id),
            cursoId: idOuNulo(req.query.curso_id),
            campusId: idOuNulo(req.query.campus_id),
            periodoLetivoId: idOuNulo(req.query.periodo_id),
            turnoId: idOuNulo(req.query.turno_id),
            professorId: idOuNulo(req.query.professor_id),
            localId: idOuNulo(req.query.local_id),
            diaSemana: diaOuNulo(req.query.dia),
            modalidade: modalidadeOuNula(req.query.modalidade),
            ativo: situacaoOuNula(req.query.ativo),
            busca: texto(req.query.busca) || null,
        },
        'Filtros inválidos.'
    );

    const criterios = {
        ...filtros,
        ...escopoDaConsulta(req.usuario),
        semHorario,
        semLocal,
    };

    const total = await aulaRepository.contar(criterios);
    const paginacao = paginacaoUtil.montar({ pagina, porPagina }, total);

    const itens = await aulaRepository.listar({
        ...criterios,
        pagina: paginacao.paginaAtual,
        porPagina: paginacao.porPagina,
    });

    const [opcoesTurma, turmas, professores, locais] = await Promise.all([
        turmaService.opcoesFiltros(req.usuario),
        turmaService.listar(req.usuario, { ativo: true, pagina: 1, porPagina: LIMITE_OPCOES }),
        professorRepository.listar({ status: true }, { limite: LIMITE_OPCOES, offset: 0 }),
        localRepository.listar({
            ativo: true,
            campusIds: escopoDaConsulta(req.usuario).campusIds || null,
            limite: LIMITE_OPCOES,
        }),
    ]);

    res.render('admin/aulas/lista', {
        tituloPagina: 'Aulas',
        subtitulo: 'Todas as aulas da grade, com filtros e pendências',
        menuAtivo: MENU,
        breadcrumbs: [{ texto: 'Painel', url: '/admin' }, { texto: 'Aulas' }],
        itens,
        paginacao,
        diasSemana: DIAS,
        modalidades: MODALIDADES,
        opcoes: { ...opcoesTurma, turmas: turmas.itens, professores, locais },
        filtros: {
            turma_id: req.query.turma_id === undefined ? '' : texto(req.query.turma_id),
            curso_id: filtros.cursoId === null ? '' : String(filtros.cursoId),
            campus_id: filtros.campusId === null ? '' : String(filtros.campusId),
            periodo_id: filtros.periodoLetivoId === null ? '' : String(filtros.periodoLetivoId),
            turno_id: filtros.turnoId === null ? '' : String(filtros.turnoId),
            professor_id: filtros.professorId === null ? '' : String(filtros.professorId),
            local_id: filtros.localId === null ? '' : String(filtros.localId),
            dia: filtros.diaSemana === null ? '' : String(filtros.diaSemana),
            modalidade: filtros.modalidade || '',
            ativo: filtros.ativo === null ? '' : String(filtros.ativo ? 1 : 0),
            busca: filtros.busca || '',
            sem_horario: semHorario,
            sem_local: semLocal,
        },
        voltar: req.originalUrl,
        urlBase: (numero) =>
            req.withBase(`${BASE}${paginacaoUtil.queryString(req.query, { pagina: numero })}`),
    });
});

// ---------------------------------------------------------------------------
// Handlers de gravacao
// ---------------------------------------------------------------------------

/**
 * POST /admin/aulas — cria uma aula na celula escolhida.
 * @type {import('express').RequestHandler}
 */
const criar = assincrono(async (req, res) => {
    garantirEstruturacao(req.usuario, 'criar aulas');

    const turmaId = idOuNulo(req.body.turma_id);
    if (turmaId === null) throw new ErroNaoEncontrado('Turma não encontrada.');
    await garantirAcessoTurma(req.usuario, turmaId);

    try {
        const aula = await aulaService.criar(dadosParaCriacao(req.body, turmaId), req.usuario);
        req.flash('sucesso', `Aula de ${aula.disciplina_nome} adicionada à grade.`);
        return res.redirect(destinoDeRetorno(req, turmaId));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarMontador(req, res, {
            turmaId,
            status: erro.status,
            acao: 'nova',
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            conflitos: conflitosDoErro(erro),
            mensagemErro: erro.message,
        });
    }
});

/**
 * POST /admin/aulas/lote — mesma aula em varios periodos (transacao unica).
 * @type {import('express').RequestHandler}
 */
const criarEmLote = assincrono(async (req, res) => {
    garantirEstruturacao(req.usuario, 'criar aulas');

    const turmaId = idOuNulo(req.body.turma_id);
    if (turmaId === null) throw new ErroNaoEncontrado('Turma não encontrada.');
    await garantirAcessoTurma(req.usuario, turmaId);

    const horarios = listaDeIds(req.body.horario_turno_ids);
    const base = dadosParaCriacao(req.body, turmaId);

    if (horarios.length === 0) {
        return renderizarMontador(req, res, {
            turmaId,
            status: 422,
            acao: 'nova',
            valores: valoresDoCorpo(req.body),
            erros: { horarioTurnoId: 'Selecione ao menos um horário.' },
            mensagemErro: 'Selecione os períodos em que a aula deve ser criada.',
        });
    }

    const listaDeDados = horarios.map((horarioTurnoId) => ({ ...base, horarioTurnoId }));

    try {
        const { criadas, conflitos } = await aulaService.criarEmLote(listaDeDados, req.usuario);

        if (conflitos.length > 0) {
            // Nada foi gravado: `criarEmLote` desfaz a transacao inteira.
            return renderizarMontador(req, res, {
                turmaId,
                status: 409,
                acao: 'nova',
                valores: valoresDoCorpo(req.body),
                conflitos,
                mensagemErro:
                    'Nenhuma aula foi criada: resolva os conflitos abaixo e tente novamente.',
            });
        }

        req.flash(
            'sucesso',
            criadas.length === 1
                ? 'Aula adicionada à grade.'
                : `${criadas.length} aulas adicionadas à grade.`
        );
        return res.redirect(destinoDeRetorno(req, turmaId));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarMontador(req, res, {
            turmaId,
            status: erro.status,
            acao: 'nova',
            valores: valoresDoCorpo(req.body),
            erros: erro.campos || {},
            conflitos: conflitosDoErro(erro),
            mensagemErro: erro.message,
        });
    }
});

/**
 * POST /admin/aulas/:id — atualiza a aula respeitando os campos do perfil.
 * @type {import('express').RequestHandler}
 */
const atualizar = assincrono(async (req, res) => {
    const aula = await aulaService.obter(req.params.id);
    await garantirAcessoTurma(req.usuario, aula.turma_id);

    const dados = camposParaAtualizacao(req.usuario, req.body);

    try {
        const atualizada = await aulaService.atualizar(aula.id, dados, req.usuario);
        req.flash('sucesso', `Aula de ${atualizada.disciplina_nome} atualizada.`);
        return res.redirect(destinoDeRetorno(req, aula.turma_id));
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;
        return renderizarMontador(req, res, {
            turmaId: aula.turma_id,
            status: erro.status,
            acao: 'editar',
            aulaSelecionada: aula,
            valores: { ...valoresDoCorpo(req.body), aula_id: String(aula.id) },
            erros: erro.campos || {},
            conflitos: conflitosDoErro(erro),
            mensagemErro: erro.message,
        });
    }
});

/**
 * Executa uma acao rapida (mover, copiar, situacao) com POST-Redirect-GET.
 * Conflitos viram mensagens flash — uma por problema encontrado.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{turmaId:number, executar:() => Promise<void>, sucesso:string}} opcoes
 */
const acaoRapida = async (req, res, { turmaId, executar, sucesso }) => {
    try {
        await executar();
        req.flash('sucesso', sucesso);
    } catch (erro) {
        if (!ehErroDeFormulario(erro)) throw erro;

        const conflitos = conflitosDoErro(erro);
        if (conflitos.length > 0) {
            conflitos.forEach((conflito) => req.flash('erro', conflito.mensagem));
        } else {
            req.flash('erro', erro.message);
        }
    }

    res.redirect(destinoDeRetorno(req, turmaId));
};

/**
 * POST /admin/aulas/:id/mover — leva a aula para outro dia/horario.
 * @type {import('express').RequestHandler}
 */
const mover = assincrono(async (req, res) => {
    garantirEstruturacao(req.usuario, 'mover aulas');

    const aula = await aulaService.obter(req.params.id);
    await garantirAcessoTurma(req.usuario, aula.turma_id);

    await acaoRapida(req, res, {
        turmaId: aula.turma_id,
        sucesso: `Aula de ${aula.disciplina_nome} movida.`,
        executar: () =>
            aulaService.mover(
                aula.id,
                { diaSemana: req.body.dia_semana, horarioTurnoId: req.body.horario_turno_id },
                req.usuario
            ),
    });
});

/**
 * POST /admin/aulas/:id/copiar — duplica a aula em outro dia/horario.
 * @type {import('express').RequestHandler}
 */
const copiar = assincrono(async (req, res) => {
    garantirEstruturacao(req.usuario, 'copiar aulas');

    const aula = await aulaService.obter(req.params.id);
    await garantirAcessoTurma(req.usuario, aula.turma_id);

    await acaoRapida(req, res, {
        turmaId: aula.turma_id,
        sucesso: `Aula de ${aula.disciplina_nome} copiada.`,
        executar: () =>
            aulaService.copiar(
                aula.id,
                {
                    turmaId: null,
                    diaSemana: req.body.dia_semana,
                    horarioTurnoId: req.body.horario_turno_id,
                },
                req.usuario
            ),
    });
});

/**
 * POST /admin/aulas/:id/inativar — tira a aula da grade preservando historico.
 * @type {import('express').RequestHandler}
 */
const inativar = assincrono(async (req, res) => {
    garantirEstruturacao(req.usuario, 'inativar aulas');

    const aula = await aulaService.obter(req.params.id);
    await garantirAcessoTurma(req.usuario, aula.turma_id);

    await acaoRapida(req, res, {
        turmaId: aula.turma_id,
        sucesso: `Aula de ${aula.disciplina_nome} inativada.`,
        executar: () => aulaService.inativar(aula.id, req.usuario),
    });
});

/**
 * POST /admin/aulas/:id/reativar — devolve a aula a grade (revalida conflitos).
 * @type {import('express').RequestHandler}
 */
const reativar = assincrono(async (req, res) => {
    garantirEstruturacao(req.usuario, 'reativar aulas');

    const aula = await aulaService.obter(req.params.id);
    await garantirAcessoTurma(req.usuario, aula.turma_id);

    await acaoRapida(req, res, {
        turmaId: aula.turma_id,
        sucesso: `Aula de ${aula.disciplina_nome} reativada.`,
        executar: () => aulaService.reativar(aula.id, req.usuario),
    });
});

/**
 * POST /admin/aulas/:id/remover — exclusao definitiva da aula.
 * @type {import('express').RequestHandler}
 */
const remover = assincrono(async (req, res) => {
    garantirEstruturacao(req.usuario, 'remover aulas');

    const aula = await aulaService.obter(req.params.id);
    await garantirAcessoTurma(req.usuario, aula.turma_id);

    await acaoRapida(req, res, {
        turmaId: aula.turma_id,
        sucesso: `Aula de ${aula.disciplina_nome} removida da grade.`,
        executar: () => aulaService.remover(aula.id, req.usuario),
    });
});

/**
 * POST /admin/aulas/turma/:turmaId/local
 *
 * Aplica o mesmo local a varias aulas da turma. E a resposta ao caso concreto
 * da carga do TOTVS: o cubo nao traz sala, entao a turma chega com dezenas de
 * aulas sem local e alocar uma a uma nao e trabalho que alguem faca.
 */
const definirLocalEmLote = assincrono(async (req, res) => {
    const turmaId = idOuNulo(req.params.turmaId);
    await garantirAcessoTurma(req.usuario, turmaId);

    let resultado;
    try {
        resultado = await aulaService.definirLocalEmLote(
            turmaId,
            {
                localId: req.body.local_id,
                disciplinas: req.body.disciplina_ids,
                dias: req.body.dia_semanas,
                horarios: req.body.horario_turno_ids,
                apenasSemLocal: req.body.apenas_sem_local,
            },
            req.usuario
        );
    } catch (erro) {
        // Local invalido (inativo, de outro campus, inexistente): a mensagem do
        // servico ja explica o motivo; a tela volta com ela em destaque.
        if (!(erro instanceof ErroValidacao)) throw erro;
        req.flash('erro', Object.values(erro.campos || {})[0] || erro.message);
        return res.redirect(destinoDeRetorno(req, turmaId));
    }

    if (resultado.alteradas > 0) {
        const acao = idOuNulo(req.body.local_id) ? 'receberam o local' : 'ficaram sem local';
        req.flash(
            'sucesso',
            `${plural(resultado.alteradas, 'aula')} ${acao}` +
                (resultado.ignoradas > 0
                    ? ` · ${resultado.ignoradas} já ${resultado.ignoradas === 1 ? 'estava' : 'estavam'} assim.`
                    : '.')
        );
    } else if (resultado.total === 0) {
        req.flash('info', 'Nenhuma aula corresponde ao filtro escolhido.');
    } else if (resultado.recusadas.length === 0) {
        req.flash('info', 'Todas as aulas selecionadas já usam este local.');
    }

    if (resultado.recusadas.length > 0) {
        // O operador precisa saber QUAIS aulas ficaram de fora e por que, para
        // resolver caso a caso — um numero solto nao ajudaria em nada.
        req.flash(
            'aviso',
            `${plural(resultado.recusadas.length, 'aula')} não ${
                resultado.recusadas.length === 1 ? 'pôde' : 'puderam'
            } receber este local: ` +
                resultado.recusadas
                    .slice(0, 4)
                    .map((item) => `${item.disciplina} (${item.faixa})`)
                    .join('; ') +
                (resultado.recusadas.length > 4 ? ' e outras.' : '.')
        );
        req.flash('aviso', resultado.recusadas[0].motivo);
    }

    return res.redirect(destinoDeRetorno(req, turmaId));
});

/**
 * POST /admin/aulas/prever — pre-visualizacao de conflitos, sem gravar.
 *
 * Responde JSON para o JavaScript do montador e, sem JavaScript, reexibe o
 * formulario preenchido com o painel de conflitos (o botao usa `formaction`).
 * @type {import('express').RequestHandler}
 */
const prever = assincrono(async (req, res) => {
    const turmaId = idOuNulo(req.body.turma_id);
    if (turmaId !== null) await garantirAcessoTurma(req.usuario, turmaId);

    const ignorarAulaId = idOuNulo(req.body.aula_id);
    const base = dadosParaCriacao(req.body, turmaId);

    // Quando o usuario marcou varios periodos, cada um e verificado e as
    // mensagens repetidas sao agrupadas.
    const horarios = listaDeIds(req.body.horario_turno_ids);
    const alvos =
        horarios.length > 0
            ? horarios.map((horarioTurnoId) => ({ ...base, horarioTurnoId }))
            : [base];

    const encontrados = [];
    for (const alvo of alvos) {
        // Sequencial: sao no maximo alguns poucos horarios por vez.
        const conflitos = await aulaService.prevendoConflitos(alvo, { ignorarAulaId });
        conflitos.forEach((conflito) => {
            if (!encontrados.some((item) => item.mensagem === conflito.mensagem)) {
                encontrados.push(conflito);
            }
        });
    }

    if (querJson(req)) {
        return res.json({ conflitos: encontrados });
    }

    if (turmaId === null) throw new ErroNaoEncontrado('Turma não encontrada.');

    const aulaSelecionada = ignorarAulaId ? await aulaService.obter(ignorarAulaId) : null;

    return renderizarMontador(req, res, {
        turmaId,
        acao: ignorarAulaId ? 'editar' : 'nova',
        aulaSelecionada,
        valores: valoresDoCorpo(req.body),
        conflitos: encontrados,
        previsao: true,
        mensagemErro:
            encontrados.length === 0
                ? null
                : 'Estes conflitos impedem salvar. Nada foi gravado ainda.',
    });
});

module.exports = {
    definirLocalEmLote,
    lista,
    selecionarTurma,
    montador,
    criar,
    criarEmLote,
    atualizar,
    mover,
    copiar,
    inativar,
    reativar,
    remover,
    prever,
};
