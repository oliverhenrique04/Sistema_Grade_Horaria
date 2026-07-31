/**
 * Regras de negocio de turmas.
 *
 * Responsabilidades:
 *  - aplicar o escopo do usuario (admin ve tudo; coordenador ve/edita apenas os
 *    cursos vinculados; nap ve apenas os campus vinculados e nao edita turmas);
 *  - garantir a coerencia curso x campus (`curso_campus`);
 *  - garantir a unicidade do codigo dentro do periodo letivo;
 *  - impedir exclusao destrutiva de turma com aulas (a acao correta e inativar).
 *
 * Escopo vazio (coordenador sem cursos, nap sem campus) nao e erro: a listagem
 * simplesmente volta vazia.
 */
const turmaRepository = require('../repositories/turmaRepository');
const escopoService = require('./escopoService');
const {
    podeAcessarCurso,
    podeAcessarCampus,
    garantirAcessoTurma,
} = require('../middlewares/autorizacao');
const {
    ErroValidacao,
    ErroDependencia,
    ErroNaoEncontrado,
    ErroPermissao,
} = require('../utils/erros');
const paginacaoUtil = require('../utils/paginacao');

/** Violacao de unicidade no PostgreSQL. */
const CODIGO_UNICO = '23505';
/** Violacao de chave estrangeira no PostgreSQL. */
const CODIGO_FK = '23503';
/** Violacao de CHECK (ex.: semestre curricular fora de 1..20). */
const CODIGO_CHECK = '23514';

/**
 * Traduz erros do banco em erros de aplicacao com mensagem por campo.
 * @param {Error & {code?:string, constraint?:string}} erro
 * @returns {never}
 */
const traduzirErroDoBanco = (erro) => {
    if (erro && erro.code === CODIGO_UNICO) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            codigo: 'Já existe uma turma com este código neste período letivo e campus.',
        });
    }

    if (erro && erro.code === CODIGO_FK) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            geral: 'Um dos vínculos selecionados não existe mais. Recarregue a página e tente novamente.',
        });
    }

    if (erro && erro.code === CODIGO_CHECK) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            semestreCurricular: 'O semestre curricular deve estar entre 1 e 20.',
        });
    }

    throw erro;
};

/**
 * Aplica o escopo do usuario as consultas de turma.
 * Devolve a funcao esperada por `turmaRepository.montarFiltro`.
 * @param {object} usuario
 * @returns {(alias:string, indiceInicial:number) => {sql:string, parametros:any[]}}
 */
const filtroDeEscopo = (usuario) => (alias, indiceInicial) =>
    escopoService.filtroTurmas(usuario, alias, indiceInicial);

/**
 * Garante que o usuario pode gravar uma turma com o curso/campus informados.
 * @param {object} usuario
 * @param {{cursoId:number, campusId:number}} dados
 * @throws {ErroPermissao}
 */
const garantirEscopoDeGravacao = (usuario, dados) => {
    if (!podeAcessarCurso(usuario, dados.cursoId)) {
        throw new ErroPermissao('Você não tem permissão para gerenciar turmas deste curso.');
    }
    if (!podeAcessarCampus(usuario, dados.campusId)) {
        throw new ErroPermissao('Você não tem permissão para gerenciar turmas deste campus.');
    }
};

/**
 * Verifica se o curso escolhido e ofertado no campus escolhido.
 * @param {{cursoId:number, campusId:number}} dados
 * @throws {ErroValidacao} com a lista de campus onde o curso e ofertado
 */
const garantirCursoNoCampus = async (dados) => {
    const ofertado = await turmaRepository.cursoOfertadoNoCampus(dados.cursoId, dados.campusId);
    if (ofertado) return;

    const campus = await turmaRepository.campusDoCurso(dados.cursoId);
    const detalhe =
        campus.length > 0
            ? `Este curso é ofertado em: ${campus.join(', ')}.`
            : 'Este curso ainda não está vinculado a nenhum campus.';

    throw new ErroValidacao('Verifique os campos destacados.', {
        cursoId: `O curso selecionado não é ofertado no campus escolhido. ${detalhe}`,
        campusId: 'Campus incompatível com o curso selecionado.',
    });
};

/**
 * Verifica a unicidade do codigo dentro do periodo letivo e do campus.
 * @param {{periodoLetivoId:number, campusId:number, codigo:string|null}} dados
 * @param {number|null} [ignorarId]
 * @throws {ErroValidacao}
 */
const garantirCodigoDisponivel = async (dados, ignorarId = null) => {
    const emUso = await turmaRepository.codigoEmUso(
        dados.periodoLetivoId,
        dados.campusId,
        dados.codigo,
        ignorarId
    );

    if (emUso) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            codigo: 'Já existe uma turma com este código neste período letivo e campus.',
        });
    }
};

/**
 * Listagem paginada respeitando o escopo do usuario.
 * @param {object} usuario
 * @param {object} filtros filtros validados + `pagina` e `porPagina`
 * @returns {Promise<{itens:object[], paginacao:object}>}
 */
const listar = async (usuario, filtros = {}) => {
    const criterios = {
        escopo: filtroDeEscopo(usuario),
        busca: filtros.busca,
        periodoLetivoId: filtros.periodoLetivoId,
        campusId: filtros.campusId,
        cursoId: filtros.cursoId,
        turnoId: filtros.turnoId,
        semestreCurricular: filtros.semestreCurricular,
        ativo: filtros.ativo,
        exibicao: filtros.exibicao === 'todas' ? 'todas' : 'grade',
    };

    const [total, integradasOcultas] = await Promise.all([
        turmaRepository.contar(criterios),
        // Quantas turmas o recorte padrao deixa de fora, para a tela dizer
        // claramente que elas existem e onde a grade delas e montada.
        criterios.exibicao === 'grade'
            ? turmaRepository.contarIntegradas(criterios)
            : Promise.resolve(0),
    ]);

    const paginacao = paginacaoUtil.montar(
        { pagina: filtros.pagina || 1, porPagina: filtros.porPagina || 20 },
        total
    );

    const itens = await turmaRepository.listar({
        ...criterios,
        limite: paginacao.porPagina,
        offset: paginacao.offset,
    });

    return { itens, paginacao, integradasOcultas };
};

/**
 * Carrega uma turma garantindo que ela esta no escopo do usuario.
 * @param {object} usuario
 * @param {number} id
 * @returns {Promise<object>}
 * @throws {ErroNaoEncontrado|ErroPermissao}
 */
const obter = async (usuario, id) => {
    await garantirAcessoTurma(usuario, id);

    const turma = await turmaRepository.buscarPorId(id);
    if (!turma) throw new ErroNaoEncontrado('Turma não encontrada.');
    return turma;
};

/**
 * Opcoes dos selects do formulario (apenas registros ativos, mais os valores ja
 * gravados na turma quando estiverem inativos).
 * @param {object} usuario
 * @param {object} [turma] valores atuais do formulario
 * @returns {Promise<{periodos:object[], campus:object[], cursos:object[],
 *                    turnos:object[], cursoCampus:Record<number, number[]>}>}
 */
const opcoesFormulario = async (usuario, turma = {}) => {
    // O coordenador so pode escolher entre os cursos do proprio escopo.
    const restringirCursos =
        usuario && usuario.perfil === 'coordenador' ? usuario.cursosIds || [] : null;

    const [periodos, campus, cursos, turnos, cursoCampus] = await Promise.all([
        turmaRepository.opcoesPeriodos(turma.periodoLetivoId || null),
        turmaRepository.opcoesCampus(turma.campusId || null),
        turmaRepository.opcoesCursos(turma.cursoId || null, restringirCursos),
        turmaRepository.opcoesTurnos(turma.turnoId || null),
        turmaRepository.mapaCursoCampus(),
    ]);

    return { periodos, campus, cursos, turnos, cursoCampus };
};

/**
 * Opcoes dos filtros da listagem (sem restricao de "incluir id atual").
 * @param {object} usuario
 * @returns {Promise<{periodos:object[], campus:object[], cursos:object[], turnos:object[]}>}
 */
const opcoesFiltros = async (usuario) => {
    const restringirCursos =
        usuario && usuario.perfil === 'coordenador' ? usuario.cursosIds || [] : null;

    const [periodos, campus, cursos, turnos] = await Promise.all([
        turmaRepository.opcoesPeriodos(),
        turmaRepository.opcoesCampus(),
        turmaRepository.opcoesCursos(null, restringirCursos),
        turmaRepository.opcoesTurnos(),
    ]);

    return { periodos, campus, cursos, turnos };
};

/**
 * Cria uma turma.
 * @param {object} usuario
 * @param {object} dados dados ja validados por `validators/turma`
 * @returns {Promise<object>} turma criada
 */
const criar = async (usuario, dados) => {
    garantirEscopoDeGravacao(usuario, dados);
    await garantirCursoNoCampus(dados);
    await garantirCodigoDisponivel(dados, null);

    try {
        // Objeto montado campo a campo: nada do corpo da requisicao passa direto.
        return await turmaRepository.inserir({
            nome: dados.nome,
            codigo: dados.codigo,
            periodoLetivoId: dados.periodoLetivoId,
            campusId: dados.campusId,
            cursoId: dados.cursoId,
            semestreCurricular: dados.semestreCurricular,
            turnoId: dados.turnoId,
            gerencial: dados.gerencial,
            ativo: dados.ativo,
        });
    } catch (erro) {
        return traduzirErroDoBanco(erro);
    }
};

/**
 * Atualiza uma turma existente.
 * @param {object} usuario
 * @param {number} id
 * @param {object} dados dados ja validados
 * @returns {Promise<object>} turma atualizada
 */
const atualizar = async (usuario, id, dados) => {
    // Escopo da turma atual (impede editar turma de outro curso/campus)...
    await garantirAcessoTurma(usuario, id);
    // ... e escopo dos novos vinculos (impede "mover" a turma para fora do escopo).
    garantirEscopoDeGravacao(usuario, dados);

    await garantirCursoNoCampus(dados);
    await garantirCodigoDisponivel(dados, id);

    try {
        const turma = await turmaRepository.atualizar(id, {
            nome: dados.nome,
            codigo: dados.codigo,
            periodoLetivoId: dados.periodoLetivoId,
            campusId: dados.campusId,
            cursoId: dados.cursoId,
            semestreCurricular: dados.semestreCurricular,
            turnoId: dados.turnoId,
            gerencial: dados.gerencial,
            ativo: dados.ativo,
        });

        if (!turma) throw new ErroNaoEncontrado('Turma não encontrada.');
        return turma;
    } catch (erro) {
        return traduzirErroDoBanco(erro);
    }
};

/**
 * Ativa ou inativa a turma (preserva o historico de aulas).
 * @param {object} usuario
 * @param {number} id
 * @param {boolean} ativo
 * @returns {Promise<object>}
 */
const definirAtivo = async (usuario, id, ativo) => {
    await garantirAcessoTurma(usuario, id);

    const turma = await turmaRepository.definirAtivo(id, ativo);
    if (!turma) throw new ErroNaoEncontrado('Turma não encontrada.');
    return turma;
};

/**
 * Exclui a turma definitivamente. Turmas com aulas nao podem ser excluidas:
 * a acao correta e inativar, preservando o historico.
 * @param {object} usuario
 * @param {number} id
 * @returns {Promise<object>} turma removida
 * @throws {ErroDependencia}
 */
const excluir = async (usuario, id) => {
    await garantirAcessoTurma(usuario, id);

    const turma = await turmaRepository.buscarPorId(id);
    if (!turma) throw new ErroNaoEncontrado('Turma não encontrada.');

    const aulas = await turmaRepository.contarAulas(id);
    if (aulas.total > 0) {
        throw new ErroDependencia(
            `A turma "${turma.nome}" possui ${aulas.total} aula(s) na grade e não pode ser excluída. Inative a turma para preservar o histórico.`
        );
    }

    try {
        await turmaRepository.excluir(id);
    } catch (erro) {
        if (erro && erro.code === CODIGO_FK) {
            throw new ErroDependencia(
                `A turma "${turma.nome}" possui registros vinculados e não pode ser excluída. Inative a turma para preservar o histórico.`
            );
        }
        throw erro;
    }

    return turma;
};

module.exports = {
    listar,
    obter,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    opcoesFormulario,
    opcoesFiltros,
};
