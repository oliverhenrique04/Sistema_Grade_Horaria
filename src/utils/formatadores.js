/**
 * Formata um valor TIME do PostgreSQL ("19:00:00") como "19:00".
 */
const hora = (valor) => {
    if (!valor) return '';
    const texto = String(valor);
    const partes = texto.split(':');
    if (partes.length < 2) return texto;
    return `${partes[0].padStart(2, '0')}:${partes[1]}`;
};

/**
 * Faixa de horario legivel: "08:00 às 08:50".
 */
const faixaHoraria = (inicio, fim) => {
    const de = hora(inicio);
    const ate = hora(fim);
    if (!de || !ate) return '';
    return `${de} às ${ate}`;
};

const MODALIDADES = [
    { valor: 'presencial', rotulo: 'Presencial', icone: 'fa-chalkboard' },
    { valor: 'ead', rotulo: 'EAD', icone: 'fa-wifi' },
    { valor: 'hibrido', rotulo: 'Híbrido', icone: 'fa-tower-broadcast' },
];

const TIPOS_LOCAL = [
    { valor: 'sala', rotulo: 'Sala' },
    { valor: 'laboratorio', rotulo: 'Laboratório' },
    { valor: 'auditorio', rotulo: 'Auditório' },
    { valor: 'skill_lab', rotulo: 'Skill Lab' },
    { valor: 'virtual', rotulo: 'Ambiente virtual' },
    { valor: 'outro', rotulo: 'Outro' },
];

const PERFIS = [
    { valor: 'admin', rotulo: 'Administrador' },
    { valor: 'coordenador', rotulo: 'Coordenador' },
    { valor: 'nap', rotulo: 'NAP / Operador de campus' },
];

const rotuloDe = (lista, valor) =>
    lista.find((item) => item.valor === valor)?.rotulo || valor || '';

const modalidadeRotulo = (valor) => rotuloDe(MODALIDADES, valor);
const tipoLocalRotulo = (valor) => rotuloDe(TIPOS_LOCAL, valor);
const perfilRotulo = (valor) => rotuloDe(PERFIS, valor);

/**
 * Ordinal em portugues: 1 -> "1º".
 */
const ordinal = (numero) => {
    const valor = Number(numero);
    return Number.isFinite(valor) ? `${valor}º` : '';
};

/**
 * Semestre curricular para exibicao. Turma gerencial e turma especial nao tem
 * semestre: o traco deixa claro que o campo nao se aplica, em vez de sugerir
 * que faltou preencher.
 * @param {number|null|undefined} valor
 * @returns {string}
 */
const semestreRotulo = (valor) => {
    if (valor === null || valor === undefined || valor === '') return '—';
    return ordinal(valor);
};

const dataBr = (valor) => {
    if (!valor) return '';
    const data = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(data.getTime())) return '';
    return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

const dataHoraBr = (valor) => {
    if (!valor) return '';
    const data = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(data.getTime())) return '';
    return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/**
 * Concorda o substantivo com a quantidade: `plural(1, 'aula')` -> "1 aula",
 * `plural(4, 'aula')` -> "4 aulas". Evita o "aula(s)" das mensagens antigas.
 * @param {number} quantidade
 * @param {string} singular
 * @param {string} [pluralizado] quando nao basta acrescentar "s"
 */
const plural = (quantidade, singular, pluralizado = `${singular}s`) =>
    `${quantidade} ${Number(quantidade) === 1 ? singular : pluralizado}`;

module.exports = {
    hora,
    plural,
    faixaHoraria,
    ordinal,
    semestreRotulo,
    dataBr,
    dataHoraBr,
    MODALIDADES,
    TIPOS_LOCAL,
    PERFIS,
    modalidadeRotulo,
    tipoLocalRotulo,
    perfilRotulo,
};
