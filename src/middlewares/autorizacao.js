/**
 * Autorizacao: perfis, matriz de permissoes e escopo (curso / campus).
 *
 * REGRA DE OURO: toda acao e verificada aqui, no backend. Esconder botoes na
 * view e apenas conforto visual, nunca controle de acesso.
 *
 * Perfis:
 *  - `admin`      : acesso total, escopo global.
 *  - `coordenador`: le tudo (exceto usuarios) e edita turmas/aulas apenas dos
 *                   cursos vinculados em `usuario_cursos`.
 *  - `nap`        : le tudo (exceto usuarios) dentro dos campus vinculados em
 *                   `usuario_campus`, edita aulas (somente o local, restricao
 *                   aplicada no controller de aulas) e mantem os locais do
 *                   proprio campus.
 *
 * Escopo vazio (coordenador sem cursos, nap sem campus) nao e erro: o usuario
 * enxerga listas vazias.
 */
const db = require('../config/db');
const { ErroPermissao, ErroAutenticacao, ErroNaoEncontrado } = require('../utils/erros');

/** Recursos protegidos pela matriz de permissoes. */
const RECURSOS = [
    'usuarios',
    'campus',
    'turnos',
    'horarios',
    'cursos',
    'periodos',
    'turmas',
    'disciplinas',
    'professores',
    'locais',
    'aulas',
    'dashboard',
    'importacao',
    'paineis',
];

/** Acoes possiveis sobre um recurso. */
const ACOES = ['ler', 'criar', 'editar', 'inativar'];

/**
 * Recursos que coordenador e nap podem apenas consultar.
 *
 * `importacao` fica de fora: uma carga do cubo reescreve turmas, disciplinas e
 * aulas de todos os cursos e campus de uma vez, o que nao cabe em nenhum dos
 * dois escopos. E exclusiva do administrador.
 *
 * `paineis` tambem: o gerador de links das TVs e liberado nominalmente a `nap`
 * logo abaixo, porque o recorte de um painel e por predio e por campus. O
 * coordenador, que enxerga por curso, nao tem o que fazer ali.
 */
const LEITURA_OPERACIONAL = RECURSOS.filter(
    (recurso) => recurso !== 'usuarios' && recurso !== 'importacao' && recurso !== 'paineis'
);

const todasAcoes = () => [...ACOES];

/**
 * Monta o mapa recurso -> acoes de um perfil.
 * @param {Record<string, string[]>} definicao
 * @returns {Record<string, string[]>}
 */
const montarPerfil = (definicao) => {
    const mapa = {};
    RECURSOS.forEach((recurso) => {
        mapa[recurso] = definicao[recurso] ? [...definicao[recurso]] : [];
    });
    return Object.freeze(mapa);
};

const permissoesLeitura = (recursos) => {
    const mapa = {};
    recursos.forEach((recurso) => {
        mapa[recurso] = ['ler'];
    });
    return mapa;
};

/**
 * Matriz de permissoes: PERMISSOES[perfil][recurso] -> lista de acoes.
 * @type {Readonly<Record<string, Readonly<Record<string, string[]>>>>}
 */
const PERMISSOES = Object.freeze({
    admin: montarPerfil(
        RECURSOS.reduce((mapa, recurso) => {
            mapa[recurso] = todasAcoes();
            return mapa;
        }, {})
    ),

    coordenador: montarPerfil({
        ...permissoesLeitura(LEITURA_OPERACIONAL),
        // Edita a grade dos cursos sob sua responsabilidade.
        turmas: todasAcoes(),
        aulas: todasAcoes(),
    }),

    nap: montarPerfil({
        ...permissoesLeitura(LEITURA_OPERACIONAL),
        // Gera os links das TVs dos blocos do proprio campus.
        paineis: ['ler'],
        // Mantem o cadastro de salas do proprio campus.
        locais: todasAcoes(),
        // Apenas ajusta a alocacao de local da aula. A restricao de quais campos
        // podem ser alterados e responsabilidade do controller de aulas.
        aulas: ['ler', 'editar'],
    }),
});

/**
 * Verifica a matriz de permissoes (sem considerar escopo de curso/campus).
 * @param {{perfil?:string}|null|undefined} usuario
 * @param {string} recurso
 * @param {string} acao
 * @returns {boolean}
 */
const temPermissao = (usuario, recurso, acao) => {
    if (!usuario || !usuario.perfil) return false;
    const doPerfil = PERMISSOES[usuario.perfil];
    if (!doPerfil) return false;
    const acoes = doPerfil[recurso];
    return Array.isArray(acoes) && acoes.includes(acao);
};

/**
 * Middleware que exige um dos perfis informados.
 * @param {...string} perfis
 * @returns {import('express').RequestHandler}
 */
const exigirPerfil =
    (...perfis) =>
    (req, res, next) => {
        if (!req.usuario) return next(new ErroAutenticacao());
        if (perfis.includes(req.usuario.perfil)) return next();
        return next(new ErroPermissao('Você não tem permissão para acessar esta área.'));
    };

/**
 * Middleware que exige uma permissao da matriz.
 * O escopo (curso/campus) e verificado a parte, com `garantirAcessoTurma`,
 * `podeAcessarCurso` ou `podeAcessarCampus`, pois depende do registro alvo.
 * @param {string} recurso
 * @param {string} acao
 * @returns {import('express').RequestHandler}
 */
const exigirPermissao = (recurso, acao) => (req, res, next) => {
    if (!req.usuario) return next(new ErroAutenticacao());
    if (temPermissao(req.usuario, recurso, acao)) return next();
    return next(new ErroPermissao('Você não tem permissão para executar esta ação.'));
};

const paraId = (valor) => {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
};

/**
 * Curso esta no escopo do usuario?
 * O eixo curso restringe apenas o coordenador; admin e nap nao sao limitados
 * por curso (o nap e limitado por campus).
 * @param {{perfil?:string, cursosIds?:number[]}|null} usuario
 * @param {number|string} cursoId
 * @returns {boolean}
 */
const podeAcessarCurso = (usuario, cursoId) => {
    if (!usuario || !usuario.perfil) return false;
    if (usuario.perfil === 'admin') return true;
    if (usuario.perfil !== 'coordenador') return true;

    const id = paraId(cursoId);
    if (id === null) return false;
    return (usuario.cursosIds || []).includes(id);
};

/**
 * Campus esta no escopo do usuario?
 * O eixo campus restringe apenas o nap; admin e coordenador nao sao limitados
 * por campus (o coordenador e limitado por curso).
 * @param {{perfil?:string, campusIds?:number[]}|null} usuario
 * @param {number|string} campusId
 * @returns {boolean}
 */
const podeAcessarCampus = (usuario, campusId) => {
    if (!usuario || !usuario.perfil) return false;
    if (usuario.perfil === 'admin') return true;
    if (usuario.perfil !== 'nap') return true;

    const id = paraId(campusId);
    if (id === null) return false;
    return (usuario.campusIds || []).includes(id);
};

/**
 * Le curso e campus da turma.
 * @param {number|string} turmaId
 * @returns {Promise<{id:number, curso_id:number|null, campus_id:number|null}|null>}
 */
const buscarEscopoTurma = async (turmaId) => {
    const id = paraId(turmaId);
    if (id === null) return null;
    const resultado = await db.query(
        'SELECT id, curso_id, campus_id FROM turmas WHERE id = $1 LIMIT 1',
        [id]
    );
    return resultado.rows[0] || null;
};

/**
 * A turma esta no escopo do usuario? Combina os dois eixos: o coordenador
 * precisa do curso vinculado, o nap precisa do campus vinculado.
 * Turma inexistente devolve `false`.
 * @param {object} usuario
 * @param {number|string} turmaId
 * @returns {Promise<boolean>}
 */
const podeAcessarTurma = async (usuario, turmaId) => {
    if (!usuario || !usuario.perfil) return false;
    if (usuario.perfil === 'admin') {
        return Boolean(await buscarEscopoTurma(turmaId));
    }

    const turma = await buscarEscopoTurma(turmaId);
    if (!turma) return false;

    return podeAcessarCurso(usuario, turma.curso_id) && podeAcessarCampus(usuario, turma.campus_id);
};

/**
 * Garante acesso a turma, distinguindo "nao existe" de "sem permissao".
 * @param {object} usuario
 * @param {number|string} turmaId
 * @returns {Promise<void>}
 * @throws {ErroNaoEncontrado|ErroPermissao}
 */
const garantirAcessoTurma = async (usuario, turmaId) => {
    const turma = await buscarEscopoTurma(turmaId);
    if (!turma) throw new ErroNaoEncontrado('Turma não encontrada.');

    if (!usuario || !usuario.perfil) {
        throw new ErroPermissao('Você não tem permissão para acessar esta turma.');
    }
    if (usuario.perfil === 'admin') return;

    const liberado =
        podeAcessarCurso(usuario, turma.curso_id) && podeAcessarCampus(usuario, turma.campus_id);

    if (!liberado) {
        throw new ErroPermissao('Você não tem permissão para acessar esta turma.');
    }
};

module.exports = {
    exigirPerfil,
    exigirPermissao,
    podeAcessarCurso,
    podeAcessarCampus,
    podeAcessarTurma,
    garantirAcessoTurma,
    temPermissao,
    PERMISSOES,
    RECURSOS,
    ACOES,
};
