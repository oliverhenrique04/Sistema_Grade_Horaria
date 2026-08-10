/* Painel de corredor: o pouco de JavaScript que a TV precisa.

   Quatro responsabilidades, e nenhuma a mais:

     1. escalar a tela de 1080x1920 para o tamanho real do monitor;
     2. andar com o relogio do cabecalho;
     3. alternar as paginas, e encher a barra que diz quanto falta;
     4. recarregar a pagina sozinha, sobrevivendo a queda de rede.

   O conteudo NAO e montado aqui: o servidor entrega todas as paginas prontas.
   Uma tela que fica meses ligada nao pode acumular estado, e remontar o DOM a
   cada minuto seria a forma mais facil de vazar memoria.

   Tudo o que se move na tela passa por aqui porque a folha de estilo nao anima
   nada: animacao de CSS vira camada no compositor, e era isso que apagava
   cabecalho, quadro e rodape na TV (o porque esta em painel.css). */
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
    const barra = document.querySelector('.barra i');
    let atual = 0;
    let paginaDesde = Date.now();

    /**
     * Enche a barra de giro, que diz quanto falta para a proxima pagina.
     *
     * Quem anda com ela e este relogio, e nao uma animacao de CSS: no navegador
     * do aplicativo das TVs toda animacao vira uma camada no compositor, e as
     * camadas promovidas eram exatamente o que a TV deixava de desenhar — o
     * rodape inteiro sumia por causa desta barrinha e das animacoes do ceu. Um
     * passo por segundo dentro dos 14 basta para dizer "ja vira".
     */
    function pintarGiro() {
        if (!barra) return;
        const fracao = Math.min(1, (Date.now() - paginaDesde) / GIRO_MS);
        barra.style.width = Math.round(fracao * 100) + '%';
    }

    function trocarPagina() {
        if (paginas.length < 2) return;

        paginas[atual].hidden = true;
        atual = (atual + 1) % paginas.length;
        paginas[atual].hidden = false;

        paginaDesde = Date.now();
        pintarGiro();

        if (indicador) {
            indicador.textContent = 'página ' + (atual + 1) + ' de ' + paginas.length;
        }
    }

    if (paginas.length > 1) {
        window.setInterval(trocarPagina, GIRO_MS);

        // Mesma corrente de setTimeout do relogio, pelo mesmo motivo.
        (function andar() {
            window.setTimeout(function () {
                pintarGiro();
                andar();
            }, 1000);
        })();
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
