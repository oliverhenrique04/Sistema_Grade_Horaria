/**
 * Regras de negocio das disciplinas.
 *
 * Responsabilidades:
 *  - validar o corpo do formulario (delegando ao schema Zod);
 *  - garantir a unicidade do codigo sem diferenciar maiusculas, com mensagem no
 *    proprio campo;
 *  - gravar a matriz curricular (`curso_disciplinas`) junto com a disciplina;
 *  - impedir exclusao de disciplina usada em aulas — nesse caso a orientacao e
 *    inativar, preservando o historico da grade.
 */
const disciplinaRepository = require('../repositories/disciplinaRepository');
const cursoRepository = require('../repositories/cursoRepository');
const { validarDisciplina, validarFiltros } = require('../validators/disciplina');
const { ErroNaoEncontrado, ErroValidacao, ErroDependencia } = require('../utils/erros');

const UNICIDADE = '23505';
const DEPENDENCIA = '23503';

const MENSAGEM_CODIGO_DUPLICADO = 'Já existe uma disciplina com este código.';

/**
 * Converte erros do PostgreSQL em erros de dominio legiveis.
 * @param {any} erro
 * @returns {any}
 */
const traduzirErroDoBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === UNICIDADE) {
        return new ErroValidacao('Verifique os campos destacados.', {
            codigo: MENSAGEM_CODIGO_DUPLICADO,
        });
    }

    if (erro.code === DEPENDENCIA) {
        return new ErroDependencia(
            'Esta disciplina está em uso na grade e não pode ser excluída. Inative-a.'
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
    if (!Number.isInteger(id) || id <= 0) throw new ErroNaoEncontrado('Disciplina não encontrada.');
    return id;
};

/**
 * Lista disciplinas com filtros e paginacao.
 * @param {Record<string, unknown>} query
 * @param {{limite:number, offset:number}} paginacao
 * @returns {Promise<{itens:object[], total:number, filtros:object}>}
 */
const listar = async (query = {}, { limite, offset }) => {
    const filtros = validarFiltros(query);
    const [itens, total] = await Promise.all([
        disciplinaRepository.listar(filtros, { limite, offset }),
        disciplinaRepository.contar(filtros),
    ]);
    return { itens, total, filtros };
};

/**
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 */
const obter = async (idBruto) => {
    const disciplina = await disciplinaRepository.buscarPorId(lerId(idBruto));
    if (!disciplina) throw new ErroNaoEncontrado('Disciplina não encontrada.');
    return disciplina;
};

/**
 * Disciplina + matriz curricular, no formato usado pelo formulario.
 * @param {unknown} idBruto
 * @returns {Promise<{disciplina:object, vinculos:object[]}>}
 */
const obterParaFormulario = async (idBruto) => {
    const disciplina = await obter(idBruto);
    const vinculos = await disciplinaRepository.listarVinculos(disciplina.id);
    return { disciplina, vinculos };
};

/**
 * Garante que nenhuma outra disciplina use o mesmo codigo.
 * @param {string|null} codigo
 * @param {number|null} ignorarId
 */
const garantirCodigoUnico = async (codigo, ignorarId = null) => {
    if (!codigo) return;

    const existente = await disciplinaRepository.buscarPorCodigo(codigo, ignorarId);
    if (existente) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            codigo: MENSAGEM_CODIGO_DUPLICADO,
        });
    }
};

/**
 * Cria uma disciplina e a vincula aos cursos informados.
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<object>}
 */
const criar = async (corpo) => {
    const dados = validarDisciplina(corpo);
    await garantirCodigoUnico(dados.codigo);

    try {
        return await disciplinaRepository.criar(dados);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Atualiza uma disciplina e regrava sua matriz curricular.
 * @param {unknown} idBruto
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<object>}
 */
const atualizar = async (idBruto, corpo) => {
    const id = lerId(idBruto);
    const atual = await disciplinaRepository.buscarPorId(id);
    if (!atual) throw new ErroNaoEncontrado('Disciplina não encontrada.');

    const dados = validarDisciplina(corpo);
    await garantirCodigoUnico(dados.codigo, id);

    try {
        const disciplina = await disciplinaRepository.atualizar(id, dados);
        if (!disciplina) throw new ErroNaoEncontrado('Disciplina não encontrada.');
        return disciplina;
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Ativa ou inativa uma disciplina.
 *
 * Inativar nunca e bloqueado: a grade ja montada continua valida e o servico de
 * conflitos impede novas aulas com disciplina inativa. O total de aulas ativas
 * volta no resultado para que a interface possa avisar o usuario.
 * @param {unknown} idBruto
 * @param {boolean} ativo
 * @returns {Promise<{disciplina:object, aulasAtivas:number}>}
 */
const definirAtivo = async (idBruto, ativo) => {
    const id = lerId(idBruto);
    const existente = await disciplinaRepository.buscarPorId(id);
    if (!existente) throw new ErroNaoEncontrado('Disciplina não encontrada.');

    const vinculos = await disciplinaRepository.contarVinculos(id);
    const disciplina = await disciplinaRepository.definirAtivo(id, ativo);

    return { disciplina, aulasAtivas: vinculos.aulasAtivas };
};

/**
 * Exclui uma disciplina. So e permitido quando ela nunca foi usada em aulas.
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 */
const excluir = async (idBruto) => {
    const id = lerId(idBruto);
    const disciplina = await disciplinaRepository.buscarPorId(id);
    if (!disciplina) throw new ErroNaoEncontrado('Disciplina não encontrada.');

    const vinculos = await disciplinaRepository.contarVinculos(id);
    if (vinculos.aulas > 0) {
        throw new ErroDependencia(
            `Não é possível excluir "${disciplina.nome}": há ${vinculos.aulas} aula(s) na grade usando esta disciplina. Inative-a.`
        );
    }

    try {
        await disciplinaRepository.excluir(id);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }

    return disciplina;
};

/**
 * Cursos disponiveis para o formulario e para o filtro da listagem.
 * @returns {Promise<object[]>}
 */
const listarCursos = () => cursoRepository.listarParaSelecao();

module.exports = {
    listar,
    obter,
    obterParaFormulario,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    listarCursos,
    lerId,
};
