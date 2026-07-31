/* Envio da planilha do cubo — enriquecimento progressivo.

   Nada aqui e necessario: o <input type="file"> e o botao de envio funcionam
   sem JavaScript. Este arquivo apenas evita duas duvidas que o formulario nu
   deixa em aberto — "o arquivo certo entrou?" e "o envio esta acontecendo?". */
(function () {
    'use strict';

    const formulario = document.querySelector('[data-envio-planilha]');
    if (!formulario) return;

    const entrada = formulario.querySelector('input[type="file"]');
    const zona = formulario.querySelector('[data-soltar-arquivo]');
    const escolhido = formulario.querySelector('[data-arquivo-escolhido]');
    const botao = formulario.querySelector('[data-enviar-planilha]');
    const rotulo = formulario.querySelector('[data-rotulo-envio]');

    /** Tamanho legivel, com espaco que nao quebra entre numero e unidade. */
    function tamanho(bytes) {
        const mb = bytes / (1024 * 1024);
        if (mb >= 1) return mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
        return Math.max(Math.round(bytes / 1024), 1).toLocaleString('pt-BR') + ' kB';
    }

    // -----------------------------------------------------------------------
    // Qual arquivo esta selecionado
    // -----------------------------------------------------------------------
    /* O <input type="file"> mostra o nome de forma diferente em cada navegador e
       trunca sem aviso. Repetir nome e tamanho abaixo dele deixa claro o que
       sera enviado antes de valer a espera da conferencia. */
    if (entrada && escolhido) {
        entrada.addEventListener('change', function () {
            const arquivo = entrada.files && entrada.files[0];
            escolhido.textContent = arquivo ? arquivo.name + ' · ' + tamanho(arquivo.size) : '';
        });
    }

    // -----------------------------------------------------------------------
    // Arrastar e soltar
    // -----------------------------------------------------------------------
    if (entrada && zona) {
        ['dragenter', 'dragover'].forEach(function (evento) {
            zona.addEventListener(evento, function (e) {
                e.preventDefault();
                zona.classList.add('importacao-soltar-ativa');
            });
        });

        ['dragleave', 'drop'].forEach(function (evento) {
            zona.addEventListener(evento, function (e) {
                e.preventDefault();
                // `dragleave` dispara ao passar sobre os filhos da zona; so
                // apaga o destaque quando o ponteiro sai dela de verdade.
                if (evento === 'dragleave' && zona.contains(e.relatedTarget)) return;
                zona.classList.remove('importacao-soltar-ativa');
            });
        });

        zona.addEventListener('drop', function (e) {
            const arquivos = e.dataTransfer && e.dataTransfer.files;
            if (!arquivos || arquivos.length === 0) return;
            entrada.files = arquivos;
            entrada.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    // -----------------------------------------------------------------------
    // Estado de envio
    // -----------------------------------------------------------------------
    /* A conferencia le a planilha inteira e simula a carga em transacao: alguns
       segundos de espera com a tela parada. Sem sinal, o operador reenvia. */
    if (botao && rotulo) {
        formulario.addEventListener('submit', function () {
            botao.disabled = true;
            rotulo.textContent = 'Conferindo…';
        });
    }
})();
