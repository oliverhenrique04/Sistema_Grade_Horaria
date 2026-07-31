/**
 * Servico de autenticacao por e-mail e senha.
 *
 * Decisoes de seguranca:
 *  - o hash e sempre bcrypt com custo 12;
 *  - a mensagem de erro e sempre a mesma (nao revela se o e-mail existe,
 *    se o usuario esta inativo ou se a senha esta errada);
 *  - o bcrypt e executado mesmo quando o usuario nao existe, comparando com um
 *    hash ficticio constante, para que o tempo de resposta nao permita
 *    enumeracao de contas.
 */
const bcrypt = require('bcrypt');
const usuarioRepository = require('../repositories/usuarioRepository');
const { ErroAutenticacao } = require('../utils/erros');

const CUSTO_BCRYPT = 12;

/** Mensagem unica para qualquer falha de login. */
const MENSAGEM_GENERICA = 'E-mail ou senha inválidos.';

/**
 * Hash de uma senha aleatoria descartada, usado apenas para gastar o mesmo
 * tempo de CPU quando o usuario nao existe ou nao possui senha cadastrada.
 * Nenhuma senha real corresponde a este hash.
 */
const HASH_FICTICIO = '$2b$12$bd5zV4jkJxGpd9n4vjAiYefmNrdEIvQjuIzwKuY9oGbXxy.QS2Xgu';

/**
 * Gera o hash bcrypt de uma senha.
 * @param {string} senha
 * @returns {Promise<string>}
 */
const gerarHash = (senha) => bcrypt.hash(String(senha), CUSTO_BCRYPT);

/**
 * Compara senha em texto puro com um hash bcrypt.
 * Nunca lanca: hash ausente ou invalido resulta em `false`.
 * @param {string} senha
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
const verificarSenha = async (senha, hash) => {
    if (!hash) return false;
    try {
        return await bcrypt.compare(String(senha), String(hash));
    } catch {
        return false;
    }
};

/**
 * Autentica um usuario.
 * @param {string} email
 * @param {string} senha
 * @returns {Promise<{id:number,nome:string,email:string,perfil:string|null,
 *                    ativo:boolean,cursosIds:number[],campusIds:number[]}>}
 * @throws {ErroAutenticacao} sempre com a mesma mensagem generica
 */
const autenticar = async (email, senha) => {
    const linha = await usuarioRepository.buscarPorEmailComSenha(email);

    // Sempre executa bcrypt, exista ou nao o usuario (protecao contra timing).
    const hash = linha && linha.senha_hash ? linha.senha_hash : HASH_FICTICIO;
    const senhaConfere = await verificarSenha(senha, hash);

    if (!linha || !linha.senha_hash || !senhaConfere || linha.ativo === false) {
        throw new ErroAutenticacao(MENSAGEM_GENERICA);
    }

    return usuarioRepository.paraUsuario(linha);
};

/**
 * Registra o login bem-sucedido (atualiza `ultimo_login_em`).
 * Falhas aqui nao devem impedir o login: sao apenas registradas no log.
 * @param {number} usuarioId
 * @returns {Promise<void>}
 */
const registrarLogin = async (usuarioId) => {
    try {
        await usuarioRepository.atualizarUltimoLogin(usuarioId);
    } catch (erro) {
        console.error('[autenticacao] falha ao registrar ultimo login:', erro.message);
    }
};

module.exports = {
    autenticar,
    registrarLogin,
    gerarHash,
    verificarSenha,
    CUSTO_BCRYPT,
    MENSAGEM_GENERICA,
};
