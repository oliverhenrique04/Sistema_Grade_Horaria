/**
 * Erros de aplicacao com status HTTP. O tratador global (middlewares/erros.js)
 * usa `status` para escolher a pagina e `publico` para decidir se a mensagem
 * pode ser exibida ao usuario final.
 */
class ErroAplicacao extends Error {
    constructor(mensagem, { status = 500, codigo = null, detalhes = null, publico = true } = {}) {
        super(mensagem);
        this.name = 'ErroAplicacao';
        this.status = status;
        this.codigo = codigo;
        this.detalhes = detalhes;
        this.publico = publico;
    }
}

class ErroValidacao extends ErroAplicacao {
    /**
     * @param {string} mensagem
     * @param {Record<string, string>} campos mapa campo -> mensagem
     */
    constructor(mensagem = 'Dados invalidos.', campos = {}) {
        super(mensagem, { status: 422, codigo: 'validacao', detalhes: campos });
        this.name = 'ErroValidacao';
        this.campos = campos;
    }
}

class ErroConflito extends ErroAplicacao {
    constructor(mensagem, detalhes = null) {
        super(mensagem, { status: 409, codigo: 'conflito', detalhes });
        this.name = 'ErroConflito';
    }
}

class ErroNaoEncontrado extends ErroAplicacao {
    constructor(mensagem = 'Registro nao encontrado.') {
        super(mensagem, { status: 404, codigo: 'nao_encontrado' });
        this.name = 'ErroNaoEncontrado';
    }
}

class ErroAutenticacao extends ErroAplicacao {
    constructor(mensagem = 'Autenticacao necessaria.') {
        super(mensagem, { status: 401, codigo: 'nao_autenticado' });
        this.name = 'ErroAutenticacao';
    }
}

class ErroPermissao extends ErroAplicacao {
    constructor(mensagem = 'Voce nao tem permissao para acessar este recurso.') {
        super(mensagem, { status: 403, codigo: 'sem_permissao' });
        this.name = 'ErroPermissao';
    }
}

class ErroDependencia extends ErroAplicacao {
    constructor(mensagem = 'Registro possui vinculos e nao pode ser excluido.') {
        super(mensagem, { status: 409, codigo: 'dependencia' });
        this.name = 'ErroDependencia';
    }
}

/**
 * Envolve handlers assincronos para que rejeicoes cheguem ao tratador global.
 */
const async = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

module.exports = {
    ErroAplicacao,
    ErroValidacao,
    ErroConflito,
    ErroNaoEncontrado,
    ErroAutenticacao,
    ErroPermissao,
    ErroDependencia,
    async,
};
