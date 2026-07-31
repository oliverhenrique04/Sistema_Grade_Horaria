/**
 * Acesso a dados de usuarios voltado a autenticacao e resolucao de escopo.
 *
 * O escopo de um usuario vem SEMPRE das tabelas de vinculo `usuario_cursos` e
 * `usuario_campus`. As colunas legadas (`senha`, `token_acesso`,
 * `curso_responsavel_id`, `unidade_responsavel`) nao sao lidas aqui e serao
 * removidas por migration.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

/** Colunas publicas do usuario (nunca inclui `senha_hash`). */
const COLUNAS_PUBLICAS = `
    u.id,
    u.nome,
    u.email,
    u.perfil,
    u.ativo,
    u.ultimo_login_em,
    u.criado_em,
    u.atualizado_em
`;

/**
 * Subconsultas que agregam o escopo do usuario em arrays de inteiros.
 * Sempre devolvem array (vazio quando nao ha vinculo), nunca NULL.
 */
const ESCOPO_AGREGADO = `
    COALESCE(
        (SELECT ARRAY_AGG(uc.curso_id ORDER BY uc.curso_id)
           FROM usuario_cursos uc
          WHERE uc.usuario_id = u.id),
        '{}'::int[]
    ) AS cursos_ids,
    COALESCE(
        (SELECT ARRAY_AGG(ucp.campus_id ORDER BY ucp.campus_id)
           FROM usuario_campus ucp
          WHERE ucp.usuario_id = u.id),
        '{}'::int[]
    ) AS campus_ids
`;

/**
 * Normaliza a linha do banco no formato usado por `req.usuario`.
 * @param {object|undefined} linha
 * @returns {{id:number,nome:string,email:string,perfil:string|null,ativo:boolean,
 *            cursosIds:number[],campusIds:number[],ultimoLoginEm?:Date}|null}
 */
const paraUsuario = (linha) => {
    if (!linha) return null;
    return {
        id: Number(linha.id),
        nome: linha.nome,
        email: linha.email,
        perfil: linha.perfil || null,
        ativo: linha.ativo !== false,
        cursosIds: (linha.cursos_ids || []).map(Number),
        campusIds: (linha.campus_ids || []).map(Number),
        ultimoLoginEm: linha.ultimo_login_em || null,
    };
};

/**
 * Busca o usuario pelo e-mail (comparacao case-insensitive) incluindo o hash da
 * senha. Uso restrito ao servico de autenticacao.
 * @param {string} email
 * @returns {Promise<object|null>} linha bruta com `senha_hash` ou null
 */
const buscarPorEmailComSenha = async (email) => {
    const resultado = await db.query(
        `SELECT ${COLUNAS_PUBLICAS}, u.senha_hash, ${ESCOPO_AGREGADO}
           FROM usuarios u
          WHERE LOWER(u.email) = LOWER($1)
          LIMIT 1`,
        [String(email || '').trim()]
    );
    return resultado.rows[0] || null;
};

/**
 * Busca um usuario pelo e-mail sem expor o hash da senha.
 * @param {string} email
 * @returns {Promise<object|null>}
 */
const buscarPorEmail = async (email) => {
    const linha = await buscarPorEmailComSenha(email);
    return paraUsuario(linha);
};

/**
 * Carrega o usuario pelo id, ja com os arrays de escopo resolvidos.
 * @param {number} id
 * @returns {Promise<{id:number,nome:string,email:string,perfil:string|null,
 *                    ativo:boolean,cursosIds:number[],campusIds:number[]}|null>}
 */
const buscarPorId = async (id) => {
    const identificador = Number(id);
    if (!Number.isInteger(identificador) || identificador <= 0) return null;

    const resultado = await db.query(
        `SELECT ${COLUNAS_PUBLICAS}, ${ESCOPO_AGREGADO}
           FROM usuarios u
          WHERE u.id = $1
          LIMIT 1`,
        [identificador]
    );

    return paraUsuario(resultado.rows[0]);
};

/**
 * Ids dos cursos vinculados ao usuario.
 * @param {number} usuarioId
 * @returns {Promise<number[]>}
 */
const listarCursosIds = async (usuarioId) => {
    const resultado = await db.query(
        'SELECT curso_id FROM usuario_cursos WHERE usuario_id = $1 ORDER BY curso_id',
        [usuarioId]
    );
    return resultado.rows.map((linha) => Number(linha.curso_id));
};

/**
 * Ids dos campus vinculados ao usuario.
 * @param {number} usuarioId
 * @returns {Promise<number[]>}
 */
const listarCampusIds = async (usuarioId) => {
    const resultado = await db.query(
        'SELECT campus_id FROM usuario_campus WHERE usuario_id = $1 ORDER BY campus_id',
        [usuarioId]
    );
    return resultado.rows.map((linha) => Number(linha.campus_id));
};

/**
 * Marca a data/hora do ultimo login bem-sucedido.
 * @param {number} usuarioId
 * @returns {Promise<void>}
 */
const atualizarUltimoLogin = async (usuarioId) => {
    await db.query('UPDATE usuarios SET ultimo_login_em = NOW() WHERE id = $1', [usuarioId]);
};

/**
 * Substitui o hash da senha do usuario.
 * @param {number} usuarioId
 * @param {string} senhaHash
 * @returns {Promise<boolean>} true quando algum registro foi atualizado
 */
const atualizarSenhaHash = async (usuarioId, senhaHash) => {
    const resultado = await db.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [
        senhaHash,
        usuarioId,
    ]);
    return resultado.rowCount > 0;
};

// ---------------------------------------------------------------------------
// CRUD administrativo (/admin/usuarios)
//
// Todas as funcoes abaixo aceitam um `executor` opcional (cliente de transacao)
// e nunca leem nem devolvem `senha_hash`: o hash so trafega como parametro de
// escrita, gerado por `services/autenticacaoService.gerarHash`.
// ---------------------------------------------------------------------------

/** Nomes dos cursos e campus vinculados, para exibir o escopo na listagem. */
const ESCOPO_NOMES = `
    COALESCE(
        (SELECT ARRAY_AGG(c.nome ORDER BY c.nome)
           FROM usuario_cursos uc
           JOIN cursos c ON c.id = uc.curso_id
          WHERE uc.usuario_id = u.id),
        '{}'::text[]
    ) AS cursos_nomes,
    COALESCE(
        (SELECT ARRAY_AGG(ca.nome ORDER BY ca.nome)
           FROM usuario_campus ucp
           JOIN campus ca ON ca.id = ucp.campus_id
          WHERE ucp.usuario_id = u.id),
        '{}'::text[]
    ) AS campus_nomes
`;

const inteiroOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : null;
};

/** Lista de ids limpa (inteiros positivos, sem repeticao). */
const idsUnicos = (lista) => [
    ...new Set((lista || []).map(Number).filter((item) => Number.isInteger(item) && item > 0)),
];

/**
 * WHERE compartilhado por `listar` e `contar`.
 * @param {{busca?:string, perfil?:string, ativo?:boolean|null}} [filtros]
 * @returns {import('../utils/consulta').ConstrutorFiltro}
 */
const montarFiltro = (filtros = {}) => {
    const filtro = novoFiltro();
    filtro.busca(['u.nome', 'u.email'], filtros.busca);
    filtro.igual('u.perfil', filtros.perfil);
    filtro.booleano('u.ativo', filtros.ativo);
    return filtro;
};

/**
 * Listagem paginada com o escopo (nomes de cursos/campus) e o ultimo login.
 * @param {{busca?:string, perfil?:string, ativo?:boolean|null,
 *          limite?:number, offset?:number}} [filtros]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listar = async (filtros = {}, executor = db) => {
    const filtro = montarFiltro(filtros);
    const parametros = [...filtro.parametros];

    const indiceLimite = filtro.proximoIndice;
    parametros.push(Math.max(inteiroOuNulo(filtros.limite) || 20, 1));
    parametros.push(Math.max(inteiroOuNulo(filtros.offset) || 0, 0));

    const resultado = await executor.query(
        `SELECT ${COLUNAS_PUBLICAS}, ${ESCOPO_NOMES}
           FROM usuarios u
           ${filtro.where}
          ORDER BY u.nome, u.email
          LIMIT $${indiceLimite} OFFSET $${indiceLimite + 1}`,
        parametros
    );

    return resultado.rows;
};

/**
 * Total de registros para os mesmos filtros de `listar`.
 * @param {{busca?:string, perfil?:string, ativo?:boolean|null}} [filtros]
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const contar = async (filtros = {}, executor = db) => {
    const filtro = montarFiltro(filtros);
    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total FROM usuarios u ${filtro.where}`,
        filtro.parametros
    );
    return resultado.rows[0].total;
};

/**
 * O e-mail ja pertence a outro usuario? (case-insensitive, mesma regra do
 * indice `ux_usuario_email`).
 * @param {string} email
 * @param {number|null} [ignorarId]
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>}
 */
const emailEmUso = async (email, ignorarId = null, executor = db) => {
    const texto = String(email || '').trim();
    if (!texto) return false;

    const resultado = await executor.query(
        `SELECT 1
           FROM usuarios
          WHERE LOWER(email) = LOWER($1)
            AND ($2::int IS NULL OR id <> $2::int)
          LIMIT 1`,
        [texto, inteiroOuNulo(ignorarId)]
    );

    return resultado.rowCount > 0;
};

/**
 * Quantidade de administradores ativos, ignorando um id.
 * Base da protecao "nunca ficar sem administrador".
 * @param {number|null} [ignorarId]
 * @param {{query: Function}} [executor]
 * @returns {Promise<number>}
 */
const contarAdminsAtivos = async (ignorarId = null, executor = db) => {
    const resultado = await executor.query(
        `SELECT COUNT(*)::int AS total
           FROM usuarios
          WHERE perfil = 'admin'
            AND ativo
            AND ($1::int IS NULL OR id <> $1::int)`,
        [inteiroOuNulo(ignorarId)]
    );
    return resultado.rows[0].total;
};

/**
 * Insere um usuario. `senhaHash` ja deve vir gerado (nunca senha em texto puro).
 * @param {{nome:string, email:string, senhaHash:string, perfil:string, ativo?:boolean}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object>} linha inserida (sem `senha_hash`)
 */
const inserir = async (dados, executor = db) => {
    const resultado = await executor.query(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nome, email, perfil, ativo, ultimo_login_em, criado_em`,
        [
            dados.nome,
            dados.email,
            dados.senhaHash,
            dados.perfil,
            dados.ativo === undefined ? true : Boolean(dados.ativo),
        ]
    );
    return resultado.rows[0];
};

/**
 * Atualiza um usuario. `senhaHash` nulo mantem o hash atual.
 * @param {number} id
 * @param {{nome:string, email:string, perfil:string, ativo?:boolean, senhaHash?:string|null}} dados
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>} linha atualizada ou null quando o id nao existe
 */
const atualizar = async (id, dados, executor = db) => {
    const resultado = await executor.query(
        `UPDATE usuarios
            SET nome = $2,
                email = $3,
                perfil = $4,
                ativo = $5,
                senha_hash = COALESCE($6, senha_hash)
          WHERE id = $1
          RETURNING id, nome, email, perfil, ativo, ultimo_login_em, criado_em`,
        [
            id,
            dados.nome,
            dados.email,
            dados.perfil,
            dados.ativo === undefined ? true : Boolean(dados.ativo),
            dados.senhaHash || null,
        ]
    );
    return resultado.rows[0] || null;
};

/**
 * Liga/desliga o acesso do usuario preservando o cadastro.
 * @param {number} id
 * @param {boolean} ativo
 * @param {{query: Function}} [executor]
 * @returns {Promise<object|null>}
 */
const definirAtivo = async (id, ativo, executor = db) => {
    const resultado = await executor.query(
        `UPDATE usuarios SET ativo = $2 WHERE id = $1
         RETURNING id, nome, email, perfil, ativo`,
        [id, Boolean(ativo)]
    );
    return resultado.rows[0] || null;
};

/**
 * Exclusao destrutiva. Os vinculos de escopo saem junto (ON DELETE CASCADE).
 * @param {number} id
 * @param {{query: Function}} [executor]
 * @returns {Promise<boolean>} true quando algum registro foi removido
 */
const excluir = async (id, executor = db) => {
    const resultado = await executor.query('DELETE FROM usuarios WHERE id = $1', [id]);
    return resultado.rowCount > 0;
};

/**
 * Regrava os cursos vinculados ao usuario (substitui o conjunto inteiro).
 * Chamar dentro da mesma transacao da gravacao do usuario.
 * @param {number} usuarioId
 * @param {number[]} cursosIds
 * @param {{query: Function}} [executor]
 * @returns {Promise<number[]>} ids efetivamente gravados
 */
const substituirCursos = async (usuarioId, cursosIds = [], executor = db) => {
    const ids = idsUnicos(cursosIds);

    await executor.query('DELETE FROM usuario_cursos WHERE usuario_id = $1', [usuarioId]);

    if (ids.length > 0) {
        await executor.query(
            `INSERT INTO usuario_cursos (usuario_id, curso_id)
             SELECT $1, valor FROM UNNEST($2::int[]) AS valor
             ON CONFLICT DO NOTHING`,
            [usuarioId, ids]
        );
    }

    return ids;
};

/**
 * Regrava os campus vinculados ao usuario (substitui o conjunto inteiro).
 * @param {number} usuarioId
 * @param {number[]} campusIds
 * @param {{query: Function}} [executor]
 * @returns {Promise<number[]>} ids efetivamente gravados
 */
const substituirCampus = async (usuarioId, campusIds = [], executor = db) => {
    const ids = idsUnicos(campusIds);

    await executor.query('DELETE FROM usuario_campus WHERE usuario_id = $1', [usuarioId]);

    if (ids.length > 0) {
        await executor.query(
            `INSERT INTO usuario_campus (usuario_id, campus_id)
             SELECT $1, valor FROM UNNEST($2::int[]) AS valor
             ON CONFLICT DO NOTHING`,
            [usuarioId, ids]
        );
    }

    return ids;
};

/**
 * Cursos oferecidos no formulario de escopo: os ativos e tambem os ja
 * vinculados ao usuario (mesmo inativos), para nao perder o vinculo.
 * @param {number[]} [vinculadosIds]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listarCursosParaEscopo = async (vinculadosIds = [], executor = db) => {
    const resultado = await executor.query(
        `SELECT id, nome, sigla, ativo
           FROM cursos
          WHERE ativo OR id = ANY($1::int[])
          ORDER BY nome`,
        [idsUnicos(vinculadosIds)]
    );
    return resultado.rows;
};

/**
 * Campus oferecidos no formulario de escopo (ativos + ja vinculados).
 * @param {number[]} [vinculadosIds]
 * @param {{query: Function}} [executor]
 * @returns {Promise<object[]>}
 */
const listarCampusParaEscopo = async (vinculadosIds = [], executor = db) => {
    const resultado = await executor.query(
        `SELECT id, nome, sigla, ativo
           FROM campus
          WHERE ativo OR id = ANY($1::int[])
          ORDER BY nome`,
        [idsUnicos(vinculadosIds)]
    );
    return resultado.rows;
};

module.exports = {
    buscarPorEmail,
    buscarPorEmailComSenha,
    buscarPorId,
    listarCursosIds,
    listarCampusIds,
    atualizarUltimoLogin,
    atualizarSenhaHash,
    paraUsuario,
    listar,
    contar,
    emailEmUso,
    contarAdminsAtivos,
    inserir,
    atualizar,
    definirAtivo,
    excluir,
    substituirCursos,
    substituirCampus,
    listarCursosParaEscopo,
    listarCampusParaEscopo,
};
