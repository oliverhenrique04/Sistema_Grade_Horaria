/**
 * Acesso a dados de disciplinas e da matriz curricular (`curso_disciplinas`).
 *
 * O codigo da disciplina e unico sem diferenciar maiusculas — o banco garante
 * isso com `ux_disciplina_codigo ON disciplinas (LOWER(codigo))`. As consultas
 * de unicidade daqui usam a mesma comparacao.
 *
 * As gravacoes que envolvem a matriz curricular rodam em transacao: disciplina e
 * vinculos precisam ser gravados juntos ou nenhum dos dois.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

const COLUNAS = `
    d.id,
    d.nome,
    d.codigo,
    d.carga_horaria,
    d.ativo,
    d.criado_em,
    d.atualizado_em
`;

const AGREGADOS = `
    (SELECT COUNT(*)::int FROM curso_disciplinas cd WHERE cd.disciplina_id = d.id) AS total_cursos,
    (SELECT COUNT(*)::int FROM aulas a WHERE a.disciplina_id = d.id) AS total_aulas,
    COALESCE((
        SELECT STRING_AGG(c.nome, ', ' ORDER BY c.nome)
          FROM curso_disciplinas cd
          JOIN cursos c ON c.id = cd.curso_id
         WHERE cd.disciplina_id = d.id
    ), '') AS cursos_nomes
`;

/**
 * Monta o WHERE da listagem.
 * @param {{busca?:string|null, cursoId?:number|null, status?:boolean|null}} filtros
 */
const montarFiltro = ({ busca, cursoId, status } = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['d.nome', 'd.codigo'], busca);
    filtro.booleano('d.ativo', status);
    if (cursoId) {
        filtro.adicionar(
            'EXISTS (SELECT 1 FROM curso_disciplinas cd WHERE cd.disciplina_id = d.id AND cd.curso_id = ?)',
            cursoId
        );
    }
    return filtro;
};

/**
 * Lista disciplinas paginadas, em ordem alfabetica.
 * @param {object} filtros
 * @param {{limite?:number, offset?:number}} paginacao
 * @returns {Promise<object[]>}
 */
const listar = async (filtros = {}, { limite = 20, offset = 0 } = {}) => {
    const filtro = montarFiltro(filtros);
    const resultado = await db.query(
        `SELECT ${COLUNAS}, ${AGREGADOS}
           FROM disciplinas d
           ${filtro.where}
          ORDER BY d.nome
          LIMIT $${filtro.proximoIndice} OFFSET $${filtro.proximoIndice + 1}`,
        [...filtro.parametros, limite, offset]
    );
    return resultado.rows;
};

/**
 * @param {object} filtros
 * @returns {Promise<number>}
 */
const contar = async (filtros = {}) => {
    const filtro = montarFiltro(filtros);
    const resultado = await db.query(
        `SELECT COUNT(*)::int AS total FROM disciplinas d ${filtro.where}`,
        filtro.parametros
    );
    return resultado.rows[0].total;
};

/**
 * @param {number} id
 * @returns {Promise<object|null>}
 */
const buscarPorId = async (id) => {
    const resultado = await db.query(
        `SELECT ${COLUNAS}, ${AGREGADOS} FROM disciplinas d WHERE d.id = $1 LIMIT 1`,
        [id]
    );
    return resultado.rows[0] || null;
};

/**
 * Procura outra disciplina com o mesmo codigo (sem diferenciar maiusculas).
 * @param {string} codigo
 * @param {number|null} [ignorarId]
 * @returns {Promise<object|null>}
 */
const buscarPorCodigo = async (codigo, ignorarId = null) => {
    const resultado = await db.query(
        `SELECT id, nome, codigo FROM disciplinas
          WHERE codigo IS NOT NULL
            AND LOWER(codigo) = LOWER($1)
            AND ($2::int IS NULL OR id <> $2)
          LIMIT 1`,
        [codigo, ignorarId]
    );
    return resultado.rows[0] || null;
};

/**
 * Vinculos da disciplina com cursos (matriz curricular).
 * @param {number} disciplinaId
 * @returns {Promise<{curso_id:number, semestre_sugerido:number|null, curso_nome:string}[]>}
 */
const listarVinculos = async (disciplinaId) => {
    const resultado = await db.query(
        `SELECT cd.curso_id, cd.semestre_sugerido, c.nome AS curso_nome
           FROM curso_disciplinas cd
           JOIN cursos c ON c.id = cd.curso_id
          WHERE cd.disciplina_id = $1
          ORDER BY c.nome`,
        [disciplinaId]
    );
    return resultado.rows;
};

/**
 * Substitui a matriz curricular da disciplina (apaga e reinsere).
 * Cursos inexistentes sao descartados pelo JOIN com `cursos`.
 * @param {import('pg').PoolClient} cliente cliente da transacao em andamento
 * @param {number} disciplinaId
 * @param {{cursoId:number, semestreSugerido:number|null}[]} vinculos
 */
const substituirVinculos = async (cliente, disciplinaId, vinculos = []) => {
    await cliente.query('DELETE FROM curso_disciplinas WHERE disciplina_id = $1', [disciplinaId]);

    if (vinculos.length === 0) return;

    const cursosIds = vinculos.map((vinculo) => vinculo.cursoId);
    const semestres = vinculos.map((vinculo) => vinculo.semestreSugerido);

    // UNNEST pareia os dois arrays sem montar SQL dinamico.
    await cliente.query(
        `INSERT INTO curso_disciplinas (curso_id, disciplina_id, semestre_sugerido)
         SELECT entrada.curso_id, $1, entrada.semestre
           FROM UNNEST($2::int[], $3::int[]) AS entrada(curso_id, semestre)
           JOIN cursos c ON c.id = entrada.curso_id
         ON CONFLICT (curso_id, disciplina_id) DO UPDATE
            SET semestre_sugerido = EXCLUDED.semestre_sugerido`,
        [disciplinaId, cursosIds, semestres]
    );
};

/**
 * Cria a disciplina e a matriz curricular numa unica transacao.
 * @param {{nome:string, codigo:string|null, cargaHoraria:number|null, ativo:boolean,
 *          vinculos:{cursoId:number, semestreSugerido:number|null}[]}} dados
 * @returns {Promise<object>}
 */
const criar = async (dados) =>
    db.transacao(async (cliente) => {
        const resultado = await cliente.query(
            `INSERT INTO disciplinas (nome, codigo, carga_horaria, ativo)
             VALUES ($1, $2, $3, $4)
             RETURNING id, nome, codigo, carga_horaria, ativo`,
            [dados.nome, dados.codigo, dados.cargaHoraria, dados.ativo]
        );

        const disciplina = resultado.rows[0];
        await substituirVinculos(cliente, disciplina.id, dados.vinculos);
        return disciplina;
    });

/**
 * Atualiza a disciplina e regrava a matriz curricular numa unica transacao.
 * @param {number} id
 * @param {object} dados mesmo formato de `criar`
 * @returns {Promise<object|null>}
 */
const atualizar = async (id, dados) =>
    db.transacao(async (cliente) => {
        const resultado = await cliente.query(
            `UPDATE disciplinas
                SET nome = $2, codigo = $3, carga_horaria = $4, ativo = $5
              WHERE id = $1
              RETURNING id, nome, codigo, carga_horaria, ativo`,
            [id, dados.nome, dados.codigo, dados.cargaHoraria, dados.ativo]
        );

        if (resultado.rowCount === 0) return null;

        await substituirVinculos(cliente, id, dados.vinculos);
        return resultado.rows[0];
    });

/**
 * @param {number} id
 * @param {boolean} ativo
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo) => {
    const resultado = await db.query(
        'UPDATE disciplinas SET ativo = $2 WHERE id = $1 RETURNING id, nome, ativo',
        [id, ativo]
    );
    return resultado.rows[0] || null;
};

/**
 * Remove a disciplina. So deve ser chamado quando nao houver aulas.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
const excluir = async (id) => {
    const resultado = await db.query('DELETE FROM disciplinas WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * @param {number} id
 * @returns {Promise<{aulas:number, aulasAtivas:number, cursos:number}>}
 */
const contarVinculos = async (id) => {
    const resultado = await db.query(
        `SELECT
            (SELECT COUNT(*)::int FROM aulas WHERE disciplina_id = $1) AS aulas,
            (SELECT COUNT(*)::int FROM aulas WHERE disciplina_id = $1 AND ativo) AS aulas_ativas,
            (SELECT COUNT(*)::int FROM curso_disciplinas WHERE disciplina_id = $1) AS cursos`,
        [id]
    );

    const linha = resultado.rows[0];
    return { aulas: linha.aulas, aulasAtivas: linha.aulas_ativas, cursos: linha.cursos };
};

module.exports = {
    listar,
    contar,
    buscarPorId,
    buscarPorCodigo,
    listarVinculos,
    criar,
    atualizar,
    definirAtivo,
    excluir,
    contarVinculos,
};
