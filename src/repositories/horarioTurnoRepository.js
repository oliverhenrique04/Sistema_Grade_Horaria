/**
 * Acesso a dados de `horarios_turno`.
 *
 * Todo o SQL de horarios do turno fica aqui. As regras estruturais (periodo de
 * exatamente 50 minutos e proibicao de sobreposicao entre horarios ativos do
 * mesmo turno) sao garantidas pelo proprio banco (CHECK + trigger), portanto
 * este modulo apenas propaga os erros do PostgreSQL para quem chamou traduzir.
 *
 * Toda funcao aceita um `executor` opcional (cliente de transacao); por padrao
 * usa o pool compartilhado.
 */
const db = require('../config/db');
const { TAMANHO_PADRAO } = require('../utils/paginacao');

const COLUNAS = `
    h.id,
    h.turno_id,
    h.nome,
    h.ordem,
    h.hora_inicio,
    h.hora_fim,
    h.ativo,
    h.criado_em,
    h.atualizado_em
`;

const inteiroOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : null;
};

/**
 * Horarios de um turno, ordenados pela ordem do periodo.
 * @param {number} turnoId
 * @param {{apenasAtivos?: boolean}} [opcoes] `apenasAtivos` padrao true
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listarPorTurno = async (turnoId, { apenasAtivos = true } = {}, executor = db) => {
    const identificador = inteiroOuNulo(turnoId);
    if (identificador === null) return [];

    const resultado = await executor.query(
        `SELECT ${COLUNAS}
           FROM horarios_turno h
          WHERE h.turno_id = $1
            AND ($2::boolean IS FALSE OR h.ativo)
          ORDER BY h.ordem, h.hora_inicio`,
        [identificador, Boolean(apenasAtivos)]
    );

    return resultado.rows;
};

/**
 * Busca um horario pelo id, ja com dados do turno.
 * @param {number} id
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const buscarPorId = async (id, executor = db) => {
    const identificador = inteiroOuNulo(id);
    if (identificador === null) return null;

    const resultado = await executor.query(
        `SELECT ${COLUNAS},
                t.nome AS turno_nome,
                t.slug AS turno_slug,
                t.ativo AS turno_ativo
           FROM horarios_turno h
           JOIN turnos t ON t.id = h.turno_id
          WHERE h.id = $1`,
        [identificador]
    );

    return resultado.rows[0] || null;
};

/**
 * Insere um novo horario de turno.
 * @param {{turnoId:number, nome:string, ordem:number, horaInicio:string,
 *          horaFim:string, ativo?:boolean}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object>} linha inserida
 */
const inserir = async (dados, executor = db) => {
    const resultado = await executor.query(
        `INSERT INTO horarios_turno (turno_id, nome, ordem, hora_inicio, hora_fim, ativo)
         VALUES ($1, $2, $3, $4::time, $5::time, $6)
         RETURNING ${COLUNAS.replace(/h\./g, '')}`,
        [
            dados.turnoId,
            dados.nome,
            dados.ordem,
            dados.horaInicio,
            dados.horaFim,
            dados.ativo === undefined ? true : Boolean(dados.ativo),
        ]
    );
    return resultado.rows[0];
};

/**
 * Atualiza um horario de turno por completo.
 * @param {number} id
 * @param {{turnoId:number, nome:string, ordem:number, horaInicio:string,
 *          horaFim:string, ativo?:boolean}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>} linha atualizada ou null quando o id nao existe
 */
const atualizar = async (id, dados, executor = db) => {
    const resultado = await executor.query(
        `UPDATE horarios_turno
            SET turno_id = $2,
                nome = $3,
                ordem = $4,
                hora_inicio = $5::time,
                hora_fim = $6::time,
                ativo = $7
          WHERE id = $1
          RETURNING ${COLUNAS.replace(/h\./g, '')}`,
        [
            id,
            dados.turnoId,
            dados.nome,
            dados.ordem,
            dados.horaInicio,
            dados.horaFim,
            dados.ativo === undefined ? true : Boolean(dados.ativo),
        ]
    );
    return resultado.rows[0] || null;
};

/**
 * Liga/desliga um horario preservando o historico das aulas que o usam.
 * @param {number} id
 * @param {boolean} ativo
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo, executor = db) => {
    const resultado = await executor.query(
        `UPDATE horarios_turno
            SET ativo = $2
          WHERE id = $1
          RETURNING ${COLUNAS.replace(/h\./g, '')}`,
        [id, Boolean(ativo)]
    );
    return resultado.rows[0] || null;
};

/**
 * Exclusao destrutiva. Deve ser chamada apenas apos `emUso()` retornar false.
 * @param {number} id
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>} true quando algum registro foi removido
 */
const excluir = async (id, executor = db) => {
    const resultado = await executor.query('DELETE FROM horarios_turno WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * Indica se o horario esta referenciado por alguma aula (ativa ou inativa).
 * @param {number} horarioId
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>}
 */
const emUso = async (horarioId, executor = db) => {
    const identificador = inteiroOuNulo(horarioId);
    if (identificador === null) return false;

    const resultado = await executor.query(
        'SELECT 1 FROM aulas WHERE horario_turno_id = $1 LIMIT 1',
        [identificador]
    );
    return resultado.rowCount > 0;
};

/**
 * Quantidade de aulas que usam o horario, separadas por situacao.
 * @param {number} horarioId
 * @param {{query: Function}} [executor]
 * @returns {Promise<{total:number, ativas:number}>}
 */
const contarAulas = async (horarioId, executor = db) => {
    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ativo)::int AS ativas
           FROM aulas
          WHERE horario_turno_id = $1`,
        [inteiroOuNulo(horarioId)]
    );
    return resultado.rows[0] || { total: 0, ativas: 0 };
};

/**
 * Monta o WHERE compartilhado por `listarTodos` e `contar`.
 * @param {{turnoId?:number, ativo?:boolean|null, busca?:string}} filtros
 * @returns {{sql:string, parametros:any[]}}
 */
const montarFiltros = ({ turnoId = null, ativo = null, busca = null } = {}) => {
    const condicoes = ['TRUE'];
    const parametros = [];

    const turno = inteiroOuNulo(turnoId);
    if (turno !== null) {
        parametros.push(turno);
        condicoes.push(`h.turno_id = $${parametros.length}`);
    }

    if (ativo === true || ativo === false) {
        parametros.push(ativo);
        condicoes.push(`h.ativo = $${parametros.length}`);
    }

    const termo = typeof busca === 'string' ? busca.trim() : '';
    if (termo) {
        parametros.push(`%${termo}%`);
        condicoes.push(
            `(h.nome ILIKE $${parametros.length} OR t.nome ILIKE $${parametros.length})`
        );
    }

    return { sql: condicoes.join(' AND '), parametros };
};

/**
 * Listagem paginada com o nome do turno.
 * @param {{turnoId?:number, ativo?:boolean|null, busca?:string,
 *          pagina?:number, porPagina?:number}} [filtros]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listarTodos = async (filtros = {}, executor = db) => {
    const { sql, parametros } = montarFiltros(filtros);
    const porPagina = Math.max(inteiroOuNulo(filtros.porPagina) || TAMANHO_PADRAO, 1);
    const pagina = Math.max(inteiroOuNulo(filtros.pagina) || 1, 1);

    parametros.push(porPagina, (pagina - 1) * porPagina);

    const resultado = await executor.query(
        `SELECT ${COLUNAS},
                t.nome AS turno_nome,
                t.slug AS turno_slug,
                (SELECT COUNT(*)::int FROM aulas a WHERE a.horario_turno_id = h.id) AS total_aulas
           FROM horarios_turno h
           JOIN turnos t ON t.id = h.turno_id
          WHERE ${sql}
          ORDER BY t.ordem, t.nome, h.ordem
          LIMIT $${parametros.length - 1} OFFSET $${parametros.length}`,
        parametros
    );

    return resultado.rows;
};

/**
 * Total de registros para os mesmos filtros de `listarTodos`.
 * @param {{turnoId?:number, ativo?:boolean|null, busca?:string}} [filtros]
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const contar = async (filtros = {}, executor = db) => {
    const { sql, parametros } = montarFiltros(filtros);

    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total
           FROM horarios_turno h
           JOIN turnos t ON t.id = h.turno_id
          WHERE ${sql}`,
        parametros
    );

    return resultado.rows[0].total;
};

/**
 * Proxima ordem livre dentro do turno (conveniencia para o formulario).
 * @param {number} turnoId
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const proximaOrdem = async (turnoId, executor = db) => {
    const resultado = await executor.query(
        'SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM horarios_turno WHERE turno_id = $1',
        [inteiroOuNulo(turnoId)]
    );
    return Number(resultado.rows[0].proxima);
};

module.exports = {
    listarPorTurno,
    buscarPorId,
    inserir,
    atualizar,
    definirAtivo,
    excluir,
    emUso,
    contarAulas,
    listarTodos,
    contar,
    proximaOrdem,
};
