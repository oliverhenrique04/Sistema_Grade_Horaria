/**
 * Regras de negocio dos cursos.
 *
 * Responsabilidades:
 *  - validar o corpo do formulario (delegando ao schema Zod);
 *  - garantir a unicidade do nome com mensagem por campo;
 *  - impedir inativacao de curso com turmas ativas e exclusao de curso com
 *    qualquer vinculo (turmas, matriz curricular ou usuarios);
 *  - traduzir violacoes de constraint do PostgreSQL em erros de dominio, para
 *    que uma corrida entre duas requisicoes nao vire erro 500.
 */
const cursoRepository = require('../repositories/cursoRepository');
const { validarCurso, validarFiltros } = require('../validators/curso');
const { ErroNaoEncontrado, ErroValidacao, ErroDependencia } = require('../utils/erros');

/** Violacao de unicidade (indice/constraint unique). */
const UNICIDADE = '23505';
/** Violacao de chave estrangeira (registro ainda referenciado). */
const DEPENDENCIA = '23503';

const MENSAGEM_NOME_DUPLICADO = 'Já existe um curso com este nome.';

/**
 * Converte erros do PostgreSQL em erros de dominio legiveis.
 * @param {any} erro
 * @returns {any} o erro traduzido (ou o original, quando nao reconhecido)
 */
const traduzirErroDoBanco = (erro) => {
    if (!erro || typeof erro.code !== 'string') return erro;

    if (erro.code === UNICIDADE) {
        return new ErroValidacao('Verifique os campos destacados.', {
            nome: MENSAGEM_NOME_DUPLICADO,
        });
    }

    if (erro.code === DEPENDENCIA) {
        return new ErroDependencia(
            'Este curso está vinculado a outros registros e não pode ser excluído. Inative-o.'
        );
    }

    return erro;
};

/**
 * Converte o id vindo da URL em inteiro positivo.
 * @param {unknown} valor
 * @returns {number}
 * @throws {ErroNaoEncontrado}
 */
const lerId = (valor) => {
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) throw new ErroNaoEncontrado('Curso não encontrado.');
    return id;
};

/**
 * Lista cursos com filtros e paginacao.
 * @param {Record<string, unknown>} query query string da requisicao
 * @param {{limite:number, offset:number}} paginacao
 * @returns {Promise<{itens:object[], total:number, filtros:object}>}
 */
const listar = async (query = {}, { limite, offset }) => {
    const filtros = validarFiltros(query);
    const [itens, total] = await Promise.all([
        cursoRepository.listar(filtros, { limite, offset }),
        cursoRepository.contar(filtros),
    ]);
    return { itens, total, filtros };
};

/**
 * Busca um curso pelo id.
 * @param {unknown} idBruto
 * @returns {Promise<object>}
 * @throws {ErroNaoEncontrado}
 */
const obter = async (idBruto) => {
    const curso = await cursoRepository.buscarPorId(lerId(idBruto));
    if (!curso) throw new ErroNaoEncontrado('Curso não encontrado.');
    return curso;
};

/**
 * Curso + ids dos campus vinculados, no formato usado pelo formulario.
 * @param {unknown} idBruto
 * @returns {Promise<{curso:object, campusIds:number[]}>}
 */
const obterParaFormulario = async (idBruto) => {
    const curso = await obter(idBruto);
    const campusIds = await cursoRepository.listarCampusIds(curso.id);
    return { curso, campusIds };
};

/**
 * Garante que nenhum outro curso use o mesmo nome.
 * @param {string} nome
 * @param {number|null} ignorarId
 * @throws {ErroValidacao}
 */
const garantirNomeUnico = async (nome, ignorarId = null) => {
    const existente = await cursoRepository.buscarPorNome(nome, ignorarId);
    if (existente) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            nome: MENSAGEM_NOME_DUPLICADO,
        });
    }
};

/**
 * Cria um curso e seus vinculos com campus.
 * @param {Record<string, unknown>} corpo corpo bruto da requisicao
 * @returns {Promise<object>}
 */
const criar = async (corpo) => {
    const dados = validarCurso(corpo);
    await garantirNomeUnico(dados.nome);

    try {
        return await cursoRepository.criar(dados);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Atualiza um curso e regrava seus vinculos com campus.
 * @param {unknown} idBruto
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<object>}
 */
const atualizar = async (idBruto, corpo) => {
    const id = lerId(idBruto);
    const atual = await cursoRepository.buscarPorId(id);
    if (!atual) throw new ErroNaoEncontrado('Curso não encontrado.');

    const dados = validarCurso(corpo);
    await garantirNomeUnico(dados.nome, id);

    // Inativar pelo formulario segue a mesma regra do botao da listagem.
    if (atual.ativo && !dados.ativo && atual.turmas_ativas > 0) {
        throw new ErroValidacao('Verifique os campos destacados.', {
            ativo: `Não é possível inativar: o curso possui ${atual.turmas_ativas} turma(s) ativa(s).`,
        });
    }

    try {
        const curso = await cursoRepository.atualizar(id, dados);
        if (!curso) throw new ErroNaoEncontrado('Curso não encontrado.');
        return curso;
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }
};

/**
 * Ativa ou inativa um curso.
 * Inativar exige que o curso nao tenha turmas ativas.
 * @param {unknown} idBruto
 * @param {boolean} ativo
 * @returns {Promise<object>}
 * @throws {ErroDependencia}
 */
const definirAtivo = async (idBruto, ativo) => {
    const id = lerId(idBruto);
    const curso = await cursoRepository.buscarPorId(id);
    if (!curso) throw new ErroNaoEncontrado('Curso não encontrado.');

    if (!ativo) {
        const vinculos = await cursoRepository.contarVinculos(id);
        if (vinculos.turmasAtivas > 0) {
            throw new ErroDependencia(
                `Não é possível inativar "${curso.nome}": existem ${vinculos.turmasAtivas} turma(s) ativa(s) neste curso.`
            );
        }
    }

    return cursoRepository.definirAtivo(id, ativo);
};

/**
 * Exclui um curso definitivamente. Só e permitido quando nao ha nenhum vinculo;
 * caso contrario a orientacao e inativar (o historico precisa ser preservado).
 * @param {unknown} idBruto
 * @returns {Promise<object>} o curso removido
 * @throws {ErroDependencia}
 */
const excluir = async (idBruto) => {
    const id = lerId(idBruto);
    const curso = await cursoRepository.buscarPorId(id);
    if (!curso) throw new ErroNaoEncontrado('Curso não encontrado.');

    const vinculos = await cursoRepository.contarVinculos(id);
    const impedimentos = [];
    if (vinculos.turmas > 0) impedimentos.push(`${vinculos.turmas} turma(s)`);
    if (vinculos.disciplinas > 0) impedimentos.push(`${vinculos.disciplinas} disciplina(s)`);
    if (vinculos.usuarios > 0) impedimentos.push(`${vinculos.usuarios} usuário(s)`);

    if (impedimentos.length > 0) {
        throw new ErroDependencia(
            `Não é possível excluir "${curso.nome}": há ${impedimentos.join(', ')} vinculado(s). Inative o curso.`
        );
    }

    try {
        await cursoRepository.excluir(id);
    } catch (erro) {
        throw traduzirErroDoBanco(erro);
    }

    return curso;
};

/**
 * Campus disponiveis para o formulario e para o filtro da listagem.
 * @returns {Promise<object[]>}
 */
const listarCampus = () => cursoRepository.listarCampus();

/**
 * Cursos em formato reduzido, para selects de outros recursos.
 * @returns {Promise<object[]>}
 */
const listarParaSelecao = () => cursoRepository.listarParaSelecao();

module.exports = {
    listar,
    obter,
    obterParaFormulario,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    listarCampus,
    listarParaSelecao,
    lerId,
};
