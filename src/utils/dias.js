/**
 * Dias da semana usados na grade. O sistema aceita segunda a sabado (1..6) e
 * nao deve ser limitado estruturalmente a cinco dias.
 */
const DIAS = [
    { valor: 1, sigla: 'SEG', nome: 'Segunda-feira', curto: 'Segunda' },
    { valor: 2, sigla: 'TER', nome: 'Terça-feira', curto: 'Terça' },
    { valor: 3, sigla: 'QUA', nome: 'Quarta-feira', curto: 'Quarta' },
    { valor: 4, sigla: 'QUI', nome: 'Quinta-feira', curto: 'Quinta' },
    { valor: 5, sigla: 'SEX', nome: 'Sexta-feira', curto: 'Sexta' },
    { valor: 6, sigla: 'SAB', nome: 'Sábado', curto: 'Sábado' },
];

const PRIMEIRO_DIA = 1;
const ULTIMO_DIA = 6;

const porValor = new Map(DIAS.map((dia) => [dia.valor, dia]));
const porSigla = new Map(DIAS.map((dia) => [dia.sigla, dia]));

const nomeDoDia = (valor) => porValor.get(Number(valor))?.nome || '';
const siglaDoDia = (valor) => porValor.get(Number(valor))?.sigla || '';
const curtoDoDia = (valor) => porValor.get(Number(valor))?.curto || '';
const valorDaSigla = (sigla) => porSigla.get(String(sigla || '').toUpperCase())?.valor || null;
const diaValido = (valor) => porValor.has(Number(valor));

module.exports = {
    DIAS,
    PRIMEIRO_DIA,
    ULTIMO_DIA,
    nomeDoDia,
    siglaDoDia,
    curtoDoDia,
    valorDaSigla,
    diaValido,
};
