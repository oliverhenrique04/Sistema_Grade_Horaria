/**
 * Bloco (predio) de um local.
 *
 * Nao existe entidade "bloco" no banco, e nao vale inventar uma so para o
 * painel: a instituicao ja codifica o predio na ultima letra do nome da sala —
 * "101 C" e do bloco C, "110 B" e do bloco B. Sao 14 dos 19 locais do campus
 * Aguas Claras; os demais ("Auditorio", "Lab 01", "Skill Lab") nao pertencem a
 * bloco nenhum e caem em "Outros".
 *
 * Isso e conveniencia do gerador de links, nao modelo: o que viaja na URL
 * continua sendo a lista de ids de locais. Assim um bloco que ganhe uma sala
 * nova exige apenas regerar o link, sem migration.
 */

/** Rotulo usado para locais que nao seguem a convencao de letra final. */
const SEM_BLOCO = 'Outros';

/**
 * Letra do bloco a que o local pertence.
 * @param {string} nome
 * @returns {string|null}
 */
const blocoDoLocal = (nome) => {
    const encontrado = /\s([A-Z])$/.exec(String(nome || '').trim());
    return encontrado ? encontrado[1] : null;
};

/**
 * Agrupa locais por bloco, na ordem alfabetica das letras, com "Outros" ao fim.
 *
 * @param {Array<{id:number, nome:string}>} locais
 * @returns {Array<{bloco:string, letra:string|null, locais:Array<object>}>}
 */
const agruparPorBloco = (locais = []) => {
    const grupos = new Map();

    locais.forEach((local) => {
        const letra = blocoDoLocal(local.nome);
        const chave = letra || SEM_BLOCO;
        if (!grupos.has(chave)) grupos.set(chave, { bloco: chave, letra, locais: [] });
        grupos.get(chave).locais.push(local);
    });

    return [...grupos.values()].sort((a, b) => {
        if (a.letra === null) return 1;
        if (b.letra === null) return -1;
        return a.letra.localeCompare(b.letra);
    });
};

module.exports = { blocoDoLocal, agruparPorBloco, SEM_BLOCO };
