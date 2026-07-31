/**
 * Regras de negocio dos horarios (periodos) de cada turno.
 *
 * O banco e a autoridade sobre duas regras estruturais:
 *  - CHECK `ck_horario_duracao_50min`: todo periodo tem exatamente 50 minutos;
 *  - gatilho `tg_valida_sobreposicao_horario`: periodos ATIVOS do mesmo turno
 *    nao podem se sobrepor (intervalos entre periodos sao permitidos).
 *
 * A funcao deste servico e traduzir esses erros (e a unicidade de ordem) em
 * mensagens de campo, para que o usuario nunca veja uma pagina de erro 500.
 *
 * A quantidade de periodos por turno e livre: nada aqui impoe um maximo.
 */
const horarioTurnoRepository = require('../repositories/horarioTurnoRepository');
const turnoRepository = require('../repositories/turnoRepository');
const paginacaoUtil = require('../utils/paginacao');
const { DURACAO_MINUTOS } = require('../validators/horarioTurno');
const {
    ErroValidacao,
    ErroConflito,
    ErroDependencia,
    ErroNaoEncontrado,
} = require('../utils/erros');

const MENSAGEM_DURACAO = `Cada horário deve durar exatamente ${DURACAO_MINUTOS} minutos.`;

/**
 * Traduz erros do PostgreSQL em erros de dominio com mensagem em portugues.
 *
 * O gatilho de sobreposicao levanta ERRCODE 23514 sem nome de constraint e com
 * mensagem ja redigida em portugues ("O horário X (07:10 às 08:00) se sobrepõe
 * ao horário Y..."), que e repassada ao usuario como esta.
 *
 * @param {any} erro
 * @returns {Error}
 */
const traduzirErroBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === '23505') {
        if (erro.constraint === 'uq_horario_turno_ordem') {
            return new ErroValidacao('Verifique os campos destacados.', {
                ordem: 'Já existe um horário com esta ordem neste turno.',
            });
        }
        return new ErroConflito('Já existe um horário com estes dados.');
    }

    if (erro.code === '23514') {
        if (erro.constraint === 'ck_horario_duracao_50min') {
            return new ErroValidacao(MENSAGEM_DURACAO, { hora_fim: MENSAGEM_DURACAO });
        }

        // Sem `constraint`: veio do RAISE EXCEPTION do gatilho de sobreposicao.
        if (!erro.constraint && erro.message) {
            return new ErroValidacao(erro.message, {
                hora_inicio: 'Este período se sobrepõe a outro horário ativo do mesmo turno.',
            });
        }

        return new ErroConflito('O horário informado não atende às regras do sistema.');
    }

    if (erro.code === '23503') {
        return new ErroDependencia(
            'Este horário está vinculado a outros registros e não pode ser excluído. Inative-o.'
        );
    }

    return erro;
};

/**
 * Lista horarios de todos os turnos, com paginacao.
 * A ordenacao (turno, ordem) e responsabilidade do repositorio.
 * @param {{turnoId?:number|null, ativo?:boolean|null, busca?:string|null,
 *          pagina?:number, porPagina?:number}} [opcoes]
 * @returns {Promise<{itens:object[], paginacao:object}>}
 */
const listar = async ({
    turnoId = null,
    ativo = null,
    busca = null,
    pagina = 1,
    porPagina = 20,
} = {}) => {
    const total = await horarioTurnoRepository.contar({ turnoId, ativo, busca });
    const paginacao = paginacaoUtil.montar({ pagina, porPagina }, total);

    const itens = await horarioTurnoRepository.listarTodos({
        turnoId,
        ativo,
        busca,
        pagina: paginacao.paginaAtual,
        porPagina: paginacao.porPagina,
    });

    return { itens, paginacao };
};

/**
 * Horarios de um turno especifico (ordenados pela ordem cadastrada).
 * @param {number} turnoId
 * @param {{apenasAtivos?:boolean}} [opcoes]
 * @returns {Promise<object[]>}
 */
const listarDoTurno = (turnoId, opcoes = {}) =>
    horarioTurnoRepository.listarPorTurno(turnoId, opcoes);

/**
 * @param {number|string} id
 * @returns {Promise<object>}
 * @throws {ErroNaoEncontrado}
 */
const obter = async (id) => {
    const horario = await horarioTurnoRepository.buscarPorId(id);
    if (!horario) throw new ErroNaoEncontrado('Horário não encontrado.');
    return horario;
};

/**
 * Garante que o turno informado existe.
 * @param {number} turnoId
 * @returns {Promise<object>}
 */
const garantirTurno = async (turnoId) => {
    const turno = await turnoRepository.buscarPorId(turnoId);
    if (!turno) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            turno_id: 'Selecione um turno válido.',
        });
    }
    return turno;
};

/**
 * Cria um horario.
 * @param {{turno_id:number, nome:string, ordem:number, hora_inicio:string,
 *          hora_fim:string, ativo:boolean}} dados ja validados
 * @returns {Promise<object>}
 */
const criar = async (dados) => {
    await garantirTurno(dados.turno_id);

    try {
        // O repositorio recebe os campos em camelCase (contrato dele); o
        // validator entrega os nomes das colunas.
        return await horarioTurnoRepository.inserir({
            turnoId: dados.turno_id,
            nome: dados.nome,
            ordem: dados.ordem,
            horaInicio: dados.hora_inicio,
            horaFim: dados.hora_fim,
            ativo: dados.ativo,
        });
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Atualiza um horario.
 * @param {number|string} id
 * @param {object} dados ja validados
 * @returns {Promise<object>}
 */
const atualizar = async (id, dados) => {
    const horario = await obter(id);
    await garantirTurno(dados.turno_id);

    try {
        const atualizado = await horarioTurnoRepository.atualizar(horario.id, {
            turnoId: dados.turno_id,
            nome: dados.nome,
            ordem: dados.ordem,
            horaInicio: dados.hora_inicio,
            horaFim: dados.hora_fim,
            ativo: dados.ativo,
        });
        if (!atualizado) throw new ErroNaoEncontrado('Horário não encontrado.');
        return atualizado;
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * Ativa ou inativa um horario. Reativar pode esbarrar na regra de sobreposicao,
 * que e traduzida em mensagem legivel.
 * @param {number|string} id
 * @param {boolean} ativo
 * @returns {Promise<object>}
 */
const definirAtivo = async (id, ativo) => {
    const horario = await obter(id);

    try {
        const atualizado = await horarioTurnoRepository.definirAtivo(horario.id, ativo);
        if (!atualizado) throw new ErroNaoEncontrado('Horário não encontrado.');
        return atualizado;
    } catch (erro) {
        const traduzido = traduzirErroBanco(erro);
        // Fora do formulario a mensagem vira aviso: ErroValidacao viraria 422.
        if (traduzido instanceof ErroValidacao) throw new ErroConflito(traduzido.message);
        throw traduzido;
    }
};

/**
 * Exclui um horario que nunca foi usado em aulas. Em uso, orienta a inativacao.
 * @param {number|string} id
 * @returns {Promise<object>} o horario removido
 */
const excluir = async (id) => {
    const horario = await obter(id);

    if (await horarioTurnoRepository.emUso(horario.id)) {
        throw new ErroDependencia(
            `Não é possível excluir o horário "${horario.nome}": ele já é usado em aulas ` +
                'da grade. Inative o horário em vez de excluí-lo.'
        );
    }

    try {
        const removido = await horarioTurnoRepository.excluir(horario.id);
        if (!removido) throw new ErroNaoEncontrado('Horário não encontrado.');
        return horario;
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
};

/**
 * O horario ja foi usado em alguma aula?
 * @param {number|string} id
 * @returns {Promise<boolean>}
 */
const emUso = (id) => horarioTurnoRepository.emUso(id);

/**
 * Proxima ordem livre no turno, usada para sugerir o campo no formulario.
 * @param {number|string} turnoId
 * @returns {Promise<number|null>} null quando o turno nao foi informado
 */
const proximaOrdem = async (turnoId) => {
    const identificador = Number(turnoId);
    if (!Number.isInteger(identificador) || identificador <= 0) return null;
    return horarioTurnoRepository.proximaOrdem(identificador);
};

module.exports = {
    listar,
    listarDoTurno,
    obter,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    emUso,
    proximaOrdem,
    MENSAGEM_DURACAO,
};
