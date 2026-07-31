/**
 * Escopo de visibilidade do usuario.
 *
 * Regras:
 *  - `admin`      -> escopo global, enxerga tudo;
 *  - `coordenador`-> restrito aos cursos vinculados em `usuario_cursos`;
 *  - `nap`        -> restrito aos campus vinculados em `usuario_campus`;
 *  - perfil ausente/desconhecido -> escopo vazio (nao enxerga nada).
 *
 * Escopo vazio nunca e erro: o usuario simplesmente ve listas vazias.
 */
const usuarioRepository = require('../repositories/usuarioRepository');

/**
 * Carrega os ids de cursos e campus vinculados ao usuario.
 * @param {number} usuarioId
 * @returns {Promise<{cursosIds:number[], campusIds:number[]}>}
 */
const carregarEscopo = async (usuarioId) => {
    const [cursosIds, campusIds] = await Promise.all([
        usuarioRepository.listarCursosIds(usuarioId),
        usuarioRepository.listarCampusIds(usuarioId),
    ]);
    return { cursosIds, campusIds };
};

/**
 * Indica se o usuario enxerga todos os registros, sem filtro de escopo.
 * @param {{perfil?:string}|null|undefined} usuario
 * @returns {boolean}
 */
const escopoGlobal = (usuario) => Boolean(usuario) && usuario.perfil === 'admin';

/**
 * Monta o fragmento de WHERE que restringe uma consulta sobre `turmas` ao
 * escopo do usuario.
 *
 * O fragmento e devolvido SEM o `AND` inicial e sem parenteses externos
 * obrigatorios (ja vem parentizado quando necessario), pronto para ser
 * concatenado a uma consulta que ja referencia a tabela `turmas` pelo alias
 * informado.
 *
 * Os placeholders comecam em `indiceInicial` ($1 por padrao) e `proximoIndice`
 * devolve o proximo indice livre, para que o chamador continue numerando os
 * proprios parametros sem colisao.
 *
 * @example
 * const base = 'SELECT t.* FROM turmas t WHERE t.ativo';
 * const parametros = [];
 * const filtro = escopoService.filtroTurmas(req.usuario, 't', parametros.length + 1);
 * let sql = base;
 * if (filtro.sql) {
 *     sql += ` AND ${filtro.sql}`;
 *     parametros.push(...filtro.parametros);
 * }
 * // proximo parametro do chamador usa $${filtro.proximoIndice}
 * sql += ` AND t.curso_id = $${filtro.proximoIndice}`;
 * parametros.push(cursoId);
 *
 * @param {{perfil?:string, cursosIds?:number[], campusIds?:number[]}|null} usuario
 * @param {string} [alias='t'] alias da tabela `turmas` na consulta
 * @param {number} [indiceInicial=1] primeiro placeholder disponivel ($N)
 * @returns {{sql:string, parametros:any[], proximoIndice:number}}
 *          `sql` vazio significa "sem restricao" (admin).
 */
const filtroTurmas = (usuario, alias = 't', indiceInicial = 1) => {
    const prefixo = alias ? `${alias}.` : '';
    const inicio = Number.isInteger(indiceInicial) && indiceInicial > 0 ? indiceInicial : 1;

    const vazio = { sql: '', parametros: [], proximoIndice: inicio };
    const negar = { sql: 'FALSE', parametros: [], proximoIndice: inicio };

    if (!usuario || !usuario.perfil) return negar;
    if (escopoGlobal(usuario)) return vazio;

    if (usuario.perfil === 'coordenador') {
        // Array vazio em `= ANY` resulta em nenhuma linha: escopo vazio, nao erro.
        return {
            sql: `${prefixo}curso_id = ANY($${inicio}::int[])`,
            parametros: [usuario.cursosIds || []],
            proximoIndice: inicio + 1,
        };
    }

    if (usuario.perfil === 'nap') {
        return {
            sql: `${prefixo}campus_id = ANY($${inicio}::int[])`,
            parametros: [usuario.campusIds || []],
            proximoIndice: inicio + 1,
        };
    }

    return negar;
};

module.exports = {
    carregarEscopo,
    filtroTurmas,
    escopoGlobal,
};
