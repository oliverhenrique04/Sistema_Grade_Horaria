/**
 * Regras de negocio dos professores.
 *
 * Responsabilidades:
 *  - validar o corpo do formulario (delegando ao schema Zod);
 *  - garantir a unicidade do e-mail sem diferenciar maiusculas, com mensagem no
 *    proprio campo;
 *  - impedir exclusao de professor que ja tenha aulas — nesse caso a orientacao
 *    e inativar, preservando o historico da grade;
 *  - informar quantas aulas ativas o professor possui ao inativa-lo (a acao nao
 *    e bloqueada; o servico de conflitos e que impede novas aulas com professor
 *    inativo).
 */
const professorRepository = require('../repositories/professorRepository');
const { validarProfessor, validarFiltros } = require('../validators/professor');
const { ErroNaoEncontrado, ErroValidacao, ErroDependencia } = require('../utils/erros');

const UNICIDADE = '23505';
const DEPENDENCIA = '23503';

const MENSAGEM_EMAIL_DUPLICADO = 'Já existe um professor com este e-mail.';

/**
 * Converte erros do PostgreSQL em erros de dominio legiveis.
 * @param {any} erro
 * @returns {any}
 */
const traduzirErroDoBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === UNICIDADE) {
        return new ErroValidacao('Verifique os campos destacados.', {
            email: MENSAGEM_EMAIL_DUPLICADO,
        });
    }

    if (erro.code === DEPENDENCIA) {
        return new ErroDependencia(
            'Este professor possui aulas na grade e não pode ser excluído. Inative-o.'
        );
    }

    return erro;
};

/**
 * @param {unknown} valor
 * @returns {number}
 * @throws {ErroNaoEncontrado}
 */
const lerId = (valor) => {
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) throw new ErroNaoEncontrado('Professor não encontrado.');
    return id;
};

/**
 * Lista professores com filtros e paginacao.
 * @param {Record<string, unknown>} query
 * @param {{limite:number, offset:number}} paginacao
 * @returns {Promise<{itens:object[], total:number, filtros:object}>}
 */
const listar = async (query = {}, { limite, offset }) => {
    const filtros = validarFiltros(query);
    const [itens, total] = await Promise.all([
        professorRepository.listar(filtros, { limite, offset }),
        professorRepository.contar(filtros),
    ]);
    return { itens, total, filtros };
};

/**
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 */
const obter = async (idBruto) => {
    const professor = await professorRepository.buscarPorId(lerId(idBruto));
    if (!professor) throw new ErroNaoEncontrado('Professor não encontrado.');
    return professor;
};

/**
 * Garante que nenhum outro professor use o mesmo e-mail.
 * @param {string|null} email
 * @param {number|null} ignorarId
 */
const garantirEmailUnico = async (email, ignorarId = null) => {
    if (!email) return;

    const existente = await professorRepository.buscarPorEmail(email, ignorarId);
    if (existente) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            email: MENSAGEM_EMAIL_DUPLICADO,
        });
    }
};

/**
 * Cria um professor.
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<object>}
 */
const criar = async (corpo) => {
    const dados = validarProfessor(corpo);
    await garantirEmailUnico(dados.email);

    try {
        return await professorRepository.criar(dados);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Atualiza um professor.
 * @param {unknown} idBruto
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<object>}
 */
const atualizar = async (idBruto, corpo) => {
    const id = lerId(idBruto);
    const atual = await professorRepository.buscarPorId(id);
    if (!atual) throw new ErroNaoEncontrado('Professor não encontrado.');

    const dados = validarProfessor(corpo);
    await garantirEmailUnico(dados.email, id);

    try {
        const professor = await professorRepository.atualizar(id, dados);
        if (!professor) throw new ErroNaoEncontrado('Professor não encontrado.');
        return professor;
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Ativa ou inativa um professor.
 *
 * Inativar nao e bloqueado: as aulas ja lancadas continuam validas. O total de
 * aulas ativas volta no resultado para que a interface avise o usuario.
 * @param {unknown} idBruto
 * @param {boolean} ativo
 * @returns {Promise<{professor:object, aulasAtivas:number}>}
 */
const definirAtivo = async (idBruto, ativo) => {
    const id = lerId(idBruto);
    const existente = await professorRepository.buscarPorId(id);
    if (!existente) throw new ErroNaoEncontrado('Professor não encontrado.');

    const vinculos = await professorRepository.contarVinculos(id);
    const professor = await professorRepository.definirAtivo(id, ativo);

    return { professor, aulasAtivas: vinculos.aulasAtivas };
};

/**
 * Exclui um professor. So e permitido quando ele nunca teve aulas atribuidas.
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 */
const excluir = async (idBruto) => {
    const id = lerId(idBruto);
    const professor = await professorRepository.buscarPorId(id);
    if (!professor) throw new ErroNaoEncontrado('Professor não encontrado.');

    const vinculos = await professorRepository.contarVinculos(id);
    if (vinculos.aulas > 0) {
        throw new ErroDependencia(
            `Não é possível excluir "${professor.nome}": há ${vinculos.aulas} aula(s) atribuída(s) a ele. Inative-o.`
        );
    }

    try {
        await professorRepository.excluir(id);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }

    return professor;
};

module.exports = {
    listar,
    obter,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    lerId,
};
