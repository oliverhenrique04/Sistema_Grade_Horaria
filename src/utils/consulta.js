/**
 * Construtor de clausulas WHERE parametrizadas.
 *
 * Existe para evitar concatenacao manual de SQL nos repositories mantendo
 * SEMPRE queries parametrizadas (nunca interpolando valores). Nao e um ORM nem
 * um modulo generico de acesso a tabelas: cada repository continua dono do seu
 * SQL, este utilitario apenas cuida da numeracao dos placeholders.
 *
 * Exemplo:
 *   const filtro = novoFiltro();
 *   filtro.igual('t.campus_id', filtros.campusId);
 *   filtro.verdadeiro('t.ativo', filtros.apenasAtivos);
 *   filtro.busca(['t.nome', 'c.nome'], filtros.q);
 *
 *   const sql = `SELECT ... FROM turmas t ${filtro.where} ORDER BY t.nome`;
 *   await db.query(sql, filtro.parametros);
 */
class ConstrutorFiltro {
    constructor(indiceInicial = 1) {
        this.condicoes = [];
        this.valores = [];
        this.indice = indiceInicial;
    }

    /**
     * Adiciona uma condicao bruta. Use `?` como marcador de cada valor.
     * Ex.: adicionar('h.hora_inicio < ?', horaFim)
     */
    adicionar(sqlComMarcadores, ...valores) {
        if (!sqlComMarcadores) return this;

        let posicao = 0;
        const sql = sqlComMarcadores.replace(/\?/g, () => {
            posicao += 1;
            return `$${this.indice++}`;
        });

        if (posicao !== valores.length) {
            throw new Error(
                `Numero de marcadores (${posicao}) diferente do numero de valores (${valores.length}).`
            );
        }

        this.condicoes.push(sql);
        this.valores.push(...valores);
        return this;
    }

    /** Ignora o filtro quando o valor e vazio (undefined, null ou ''). */
    igual(coluna, valor) {
        if (valor === undefined || valor === null || valor === '') return this;
        return this.adicionar(`${coluna} = ?`, valor);
    }

    diferente(coluna, valor) {
        if (valor === undefined || valor === null || valor === '') return this;
        return this.adicionar(`${coluna} <> ?`, valor);
    }

    /** Filtra por booleano apenas quando `valor` e realmente booleano. */
    booleano(coluna, valor) {
        if (typeof valor !== 'boolean') return this;
        return this.adicionar(`${coluna} = ?`, valor);
    }

    /** Busca textual case-insensitive em uma ou mais colunas. */
    busca(colunas, termo) {
        const texto = typeof termo === 'string' ? termo.trim() : '';
        if (!texto || colunas.length === 0) return this;

        const partes = colunas.map((coluna) => {
            const marcador = `$${this.indice++}`;
            this.valores.push(`%${texto}%`);
            return `${coluna} ILIKE ${marcador}`;
        });

        this.condicoes.push(`(${partes.join(' OR ')})`);
        return this;
    }

    /** Restringe a uma lista de valores. Lista vazia => nenhum resultado. */
    em(coluna, lista) {
        if (!Array.isArray(lista)) return this;

        if (lista.length === 0) {
            this.condicoes.push('FALSE');
            return this;
        }

        const marcadores = lista.map(() => `$${this.indice++}`);
        this.valores.push(...lista);
        this.condicoes.push(`${coluna} IN (${marcadores.join(', ')})`);
        return this;
    }

    /** Aplica um fragmento pronto (ex.: escopo do usuario) ja parametrizado. */
    fragmento(sql, parametros = []) {
        if (!sql) return this;
        this.condicoes.push(`(${sql})`);
        this.valores.push(...parametros);
        this.indice += parametros.length;
        return this;
    }

    get where() {
        return this.condicoes.length > 0 ? `WHERE ${this.condicoes.join(' AND ')}` : '';
    }

    /** Igual a `where`, porem sem a palavra WHERE (para compor com outra clausula). */
    get condicao() {
        return this.condicoes.length > 0 ? this.condicoes.join(' AND ') : 'TRUE';
    }

    get parametros() {
        return this.valores;
    }

    /** Proximo indice livre, util para acrescentar LIMIT/OFFSET. */
    get proximoIndice() {
        return this.indice;
    }
}

const novoFiltro = (indiceInicial = 1) => new ConstrutorFiltro(indiceInicial);

module.exports = { ConstrutorFiltro, novoFiltro };
