/* Formulario de horarios do turno.

   Progressive enhancement: sugere a hora de termino a partir da hora de inicio,
   somando a duracao fixa do periodo. O servidor e o banco continuam validando a
   regra; sem JavaScript o formulario funciona normalmente. */
(function () {
    'use strict';

    const inicio = document.getElementById('campo-hora-inicio');
    const fim = document.getElementById('campo-hora-fim');

    if (!inicio || !fim) return;

    const informada = parseInt(inicio.getAttribute('data-duracao-minutos'), 10);
    const duracao = informada && informada > 0 ? informada : 50;

    /* Valor deixado pela sugestao anterior: so sobrescrevemos o que foi
       preenchido automaticamente, nunca o que a pessoa digitou. */
    let ultimaSugestao = '';

    function doisDigitos(numero) {
        const texto = String(numero);
        return texto.length < 2 ? '0' + texto : texto;
    }

    function somar(hora) {
        const partes = /^(\d{2}):(\d{2})/.exec(hora || '');
        if (!partes) return '';

        const total = parseInt(partes[1], 10) * 60 + parseInt(partes[2], 10) + duracao;
        if (total >= 24 * 60) return '';

        return doisDigitos(Math.floor(total / 60)) + ':' + doisDigitos(total % 60);
    }

    function sugerir() {
        const sugestao = somar(inicio.value);
        if (!sugestao) return;

        if (fim.value === '' || fim.value === ultimaSugestao) {
            fim.value = sugestao;
            ultimaSugestao = sugestao;
        }
    }

    inicio.addEventListener('change', sugerir);
    inicio.addEventListener('input', sugerir);
})();
