/* Painel de corredor: o pouco de JavaScript que a TV precisa.

   Quatro responsabilidades, e nenhuma a mais:

     1. escalar a tela de 1080x1920 para o tamanho real do monitor;
     2. andar com o relogio do cabecalho;
     3. alternar as paginas quando o recorte nao cabe numa so;
     4. recarregar a pagina sozinha, sobrevivendo a queda de rede.

   O conteudo NAO e montado aqui: o servidor entrega todas as paginas prontas.
   Uma tela que fica meses ligada nao pode acumular estado, e remontar o DOM a
   cada minuto seria a forma mais facil de vazar memoria. */
(function () {
    'use strict';

    const LARGURA = 1080;
    const ALTURA = 1920;

    /** Quanto tempo cada pagina fica no ar antes de dar lugar a proxima. */
    const GIRO_MS = 14000;

    /** Intervalo alvo entre recargas. O conteudo muda com o relogio. */
    const RECARGA_MS = 60000;

    /**
     * Recuo quando a recarga falha. A rede da instituicao cai; o painel espera
     * mais a cada tentativa em vez de martelar o servidor, e volta ao intervalo
     * normal assim que a resposta chega.
     */
    const RECUOS_MS = [60000, 120000, 300000];

    const tv = document.getElementById('tv');
    const quadro = document.getElementById('quadro');
    if (!tv) return;

    const roteiro = document.currentScript || document.querySelector('script[data-paginas]');
    const totalPaginas = Number((roteiro && roteiro.dataset.paginas) || 0);

    /* ------------------------------------------------------------- escala */

    function escalar() {
        const escala = Math.min(window.innerWidth / LARGURA, window.innerHeight / ALTURA);
        tv.style.setProperty('--escala', String(escala));
        // Centraliza a sobra, para a TV nao ficar com a tarja so de um lado.
        tv.style.left = Math.max(0, (window.innerWidth - LARGURA * escala) / 2) + 'px';
        tv.style.top = Math.max(0, (window.innerHeight - ALTURA * escala) / 2) + 'px';
    }

    escalar();
    window.addEventListener('resize', escalar);

    /* ------------------------------------------------------------ relogio */

    const horaAlvo = document.getElementById('relogioHora');
    const segundosAlvo = document.getElementById('relogioSegundos');

    function doisDigitos(valor) {
        return (valor < 10 ? '0' : '') + valor;
    }

    /**
     * O relogio exibido e o do NAVEGADOR, no fuso da instituicao. O servidor ja
     * decidiu a faixa do dia com o relogio dele; este aqui so anda entre uma
     * recarga e outra, para os segundos nao congelarem na tela.
     */
    function pintarRelogio() {
        const agora = new Date();
        let partes = null;

        try {
            partes = new Intl.DateTimeFormat('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hourCycle: 'h23',
            }).formatToParts(agora);
        } catch {
            partes = null;
        }

        if (!partes) {
            // Navegador de TV antiga sem base de fusos: mostra a hora local.
            if (horaAlvo) {
                horaAlvo.textContent =
                    doisDigitos(agora.getHours()) + ':' + doisDigitos(agora.getMinutes());
            }
            if (segundosAlvo) segundosAlvo.textContent = ':' + doisDigitos(agora.getSeconds());
            return;
        }

        const campo = function (tipo) {
            const parte = partes.filter(function (item) {
                return item.type === tipo;
            })[0];
            return parte ? parte.value : '00';
        };

        if (horaAlvo) horaAlvo.textContent = campo('hour') + ':' + campo('minute');
        if (segundosAlvo) segundosAlvo.textContent = ':' + campo('second');
    }

    pintarRelogio();

    // Corrente de setTimeout, nunca setInterval: uma aba suspensa nao acumula
    // disparos atrasados para executar todos de uma vez ao voltar.
    (function tique() {
        window.setTimeout(function () {
            pintarRelogio();
            tique();
        }, 1000);
    })();

    /* ------------------------------------------------------------ paginas */

    const paginas = quadro ? quadro.querySelectorAll('.pagina') : [];
    const indicador = document.getElementById('indicadorPagina');
    let atual = 0;

    /** Folga sobre a cascata inteira de entrada (18 linhas x 20 ms + 340 ms). */
    const ASSENTAR_MS = 1500;
    let assentamento = null;

    /**
     * Tira a animacao de entrada do caminho depois que ela ja aconteceu.
     *
     * A animacao usa `fill: both`: ate ela rodar, a linha esta invisivel. Onde
     * ela nao roda — compositor sem memoria para mais uma camada 3D, pagina
     * carregada oculta pelo aplicativo da TV — a aula sumiria da grade sem que
     * ninguem por perto pudesse recarregar. Assentada, a linha nao depende mais
     * de animacao nenhuma para aparecer.
     */
    function assentar(pagina) {
        window.clearTimeout(assentamento);
        assentamento = window.setTimeout(function () {
            const linhas = pagina.querySelectorAll('.linha');
            for (let i = 0; i < linhas.length; i += 1) {
                linhas[i].classList.add('assentada');
            }
        }, ASSENTAR_MS);
    }

    if (paginas.length) assentar(paginas[atual]);

    function trocarPagina() {
        if (paginas.length < 2) return;

        paginas[atual].hidden = true;
        atual = (atual + 1) % paginas.length;
        paginas[atual].hidden = false;

        if (indicador) {
            indicador.textContent = 'página ' + (atual + 1) + ' de ' + paginas.length;
        }

        // Reinicia a animacao de entrada das linhas da pagina que aparece.
        const linhas = paginas[atual].querySelectorAll('.linha');
        for (let i = 0; i < linhas.length; i += 1) {
            linhas[i].classList.remove('assentada');
            linhas[i].style.animation = 'none';
            // Leitura forcada: sem ela o navegador funde as duas atribuicoes e
            // a animacao nao recomeca.
            void linhas[i].offsetWidth;
            linhas[i].style.animation = '';
        }

        assentar(paginas[atual]);
    }

    if (paginas.length > 1) {
        const barra = document.querySelector('.barra i');
        if (barra) barra.style.setProperty('--giro', GIRO_MS + 'ms');
        window.setInterval(trocarPagina, GIRO_MS);
    }

    /* ------------------------------------------------------------ recarga */

    const estadoRede = document.getElementById('estadoRede');
    const carregadoEm = Date.now();
    let falhas = 0;

    function anunciar(texto, problema) {
        if (!estadoRede) return;
        estadoRede.textContent = texto;
        estadoRede.className = problema ? 'desatualizado' : '';
    }

    anunciar('atualiza a cada ' + RECARGA_MS / 1000 + ' s', false);

    function adiar() {
        falhas += 1;
        const minutos = Math.round((Date.now() - carregadoEm) / 60000);
        anunciar('sem conexão · dados de ' + minutos + ' min atrás', true);
        window.setTimeout(tentarRecarregar, RECUOS_MS[Math.min(falhas - 1, RECUOS_MS.length - 1)]);
    }

    /**
     * Confere que o servidor responde antes de recarregar. Recarregar as cegas
     * numa queda de rede substituiria o quadro pela pagina de erro do
     * navegador — e ai a TV nao volta sozinha.
     */
    function tentarRecarregar() {
        const pedido = new XMLHttpRequest();
        let respondeu = false;

        const desistir = function () {
            if (respondeu) return;
            respondeu = true;
            adiar();
        };

        pedido.onreadystatechange = function () {
            if (pedido.readyState !== 4 || respondeu) return;
            respondeu = true;

            if (pedido.status >= 200 && pedido.status < 400) {
                window.location.reload();
                return;
            }
            adiar();
        };

        pedido.onerror = desistir;
        pedido.ontimeout = desistir;

        try {
            pedido.open('HEAD', window.location.href, true);
            pedido.timeout = 8000;
            pedido.send();
        } catch {
            desistir();
        }
    }

    function agendarRecarga() {
        // Nunca recarrega no meio de um giro: espera a ultima pagina sair de
        // cena, para ninguem perder metade da grade a cada minuto.
        let espera = RECARGA_MS;
        if (totalPaginas > 1) {
            const cicloCompleto = totalPaginas * GIRO_MS;
            espera = Math.ceil(RECARGA_MS / cicloCompleto) * cicloCompleto;
        }
        window.setTimeout(tentarRecarregar, espera);
    }

    agendarRecarga();

    // A volta da rede nao precisa esperar o recuo terminar.
    window.addEventListener('online', function () {
        falhas = 0;
        tentarRecarregar();
    });
})();
