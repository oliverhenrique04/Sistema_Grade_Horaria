/* Comportamentos do painel administrativo.
   Progressive enhancement: nada aqui e obrigatorio para o sistema funcionar. */
(function () {
    'use strict';

    const menu = document.getElementById('menu-lateral');
    const overlay = document.querySelector('.painel-overlay');
    const gatilhos = document.querySelectorAll('[data-abrir-menu]');
    const telaEstreita = window.matchMedia('(max-width: 991.98px)');

    /**
     * Em telas estreitas o menu fechado fica fora da tela: precisa sair tambem
     * da ordem de tabulacao, senao o teclado percorre links invisiveis.
     */
    function sincronizarAcessibilidade() {
        if (!menu) return;
        const escondido = telaEstreita.matches && !menu.classList.contains('aberto');
        menu.inert = escondido;
        menu.setAttribute('aria-hidden', escondido ? 'true' : 'false');
        gatilhos.forEach(function (botao) {
            botao.setAttribute(
                'aria-expanded',
                menu.classList.contains('aberto') ? 'true' : 'false'
            );
        });
    }

    function abrirMenu() {
        if (!menu) return;
        menu.classList.add('aberto');
        if (overlay) overlay.hidden = false;
        sincronizarAcessibilidade();
        const primeiroLink = menu.querySelector('a, button');
        if (primeiroLink) primeiroLink.focus();
    }

    function fecharMenu(devolverFoco) {
        if (!menu) return;
        const estavaAberto = menu.classList.contains('aberto');
        menu.classList.remove('aberto');
        if (overlay) overlay.hidden = true;
        sincronizarAcessibilidade();

        // Devolve o foco ao botao que abriu o menu, para nao perder o contexto.
        if (estavaAberto && devolverFoco && gatilhos.length > 0) {
            const visivel = Array.prototype.find.call(gatilhos, function (botao) {
                return botao.offsetParent !== null;
            });
            if (visivel) visivel.focus();
        }
    }

    gatilhos.forEach(function (botao) {
        botao.addEventListener('click', abrirMenu);
    });

    telaEstreita.addEventListener('change', sincronizarAcessibilidade);
    sincronizarAcessibilidade();

    document.querySelectorAll('[data-fechar-menu]').forEach(function (elemento) {
        elemento.addEventListener('click', function () {
            fecharMenu(true);
        });
    });

    document.addEventListener('keydown', function (evento) {
        if (evento.key === 'Escape') fecharMenu(true);
    });

    // Confirmacao para acoes destrutivas ou de inativacao.
    document.querySelectorAll('form[data-confirmar]').forEach(function (formulario) {
        formulario.addEventListener('submit', function (evento) {
            const mensagem = formulario.getAttribute('data-confirmar');
            if (mensagem && !window.confirm(mensagem)) {
                evento.preventDefault();
            }
        });
    });

    // Submete filtros automaticamente ao trocar um select marcado.
    document.querySelectorAll('[data-submete-ao-mudar]').forEach(function (campo) {
        campo.addEventListener('change', function () {
            if (campo.form) campo.form.submit();
        });
    });

    // -----------------------------------------------------------------------
    // Selects buscaveis (`data-buscavel`)
    // -----------------------------------------------------------------------
    /*
     * Um campus com 17 salas cabe num <select>, mas achar "204 B" no meio dele
     * exige rolar a lista inteira. Aqui o proprio campo aceita digitacao: a
     * lista abaixo filtra a cada tecla, e nao ha caixa de busca separada.
     *
     * E o padrao ARIA de combobox: um <input role="combobox"> comandando uma
     * <ul role="listbox">. O <select> original continua no formulario, fora da
     * ordem de tabulacao, guardando o valor — e ele que e enviado.
     *
     * Sem JavaScript nada disso e construido: o <select> aparece inteiro e o
     * formulario funciona como sempre funcionou.
     */
    const MINIMO_PARA_BUSCA = 8;
    let sequenciaCombo = 0;

    /** Texto comparavel: sem acento, sem caixa, sem espaco sobrando. */
    function comparavel(texto) {
        return String(texto || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    function tornarBuscavel(select) {
        const id = 'combo-' + ++sequenciaCombo;
        const opcoes = Array.from(select.options).map(function (opcao, indice) {
            return {
                valor: opcao.value,
                rotulo: opcao.textContent.trim().replace(/\s+/g, ' '),
                busca: comparavel(opcao.textContent),
                id: id + '-opcao-' + indice,
            };
        });

        const caixa = document.createElement('div');
        caixa.className = 'combo';

        const campo = document.createElement('input');
        campo.type = 'text';
        campo.id = id + '-campo';
        campo.className =
            'form-select combo-campo' +
            (select.classList.contains('form-select-sm') ? ' form-select-sm' : '');
        campo.autocomplete = 'off';
        campo.setAttribute('role', 'combobox');
        campo.setAttribute('aria-expanded', 'false');
        campo.setAttribute('aria-controls', id + '-lista');
        campo.setAttribute('aria-autocomplete', 'list');

        const lista = document.createElement('ul');
        lista.id = id + '-lista';
        lista.className = 'combo-lista';
        lista.hidden = true;
        lista.setAttribute('role', 'listbox');

        // O rotulo do <select> passa a apontar para o campo; sem isso o clique
        // no rotulo focaria um elemento que o usuario nao ve mais.
        const rotulo = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
        if (rotulo) {
            rotulo.setAttribute('for', campo.id);
        } else {
            campo.setAttribute(
                'aria-label',
                'Buscar em ' + (select.getAttribute('data-buscavel') || 'opções')
            );
        }

        select.parentNode.insertBefore(caixa, select);
        caixa.appendChild(campo);
        caixa.appendChild(lista);
        caixa.appendChild(select);

        // O <select> sai da tela e da tabulacao, mas continua no formulario: e
        // ele que carrega o valor enviado.
        select.classList.add('combo-nativo');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        let visiveis = [];
        let ativo = -1;

        function rotuloDoValor(valor) {
            const achado = opcoes.find(function (opcao) {
                return opcao.valor === valor;
            });
            return achado ? achado.rotulo : '';
        }

        function marcar(indice) {
            const itens = lista.querySelectorAll('.combo-item');
            itens.forEach(function (item) {
                item.classList.remove('combo-item-ativo');
            });

            ativo = indice;
            if (indice < 0 || indice >= itens.length) {
                campo.removeAttribute('aria-activedescendant');
                return;
            }

            const item = itens[indice];
            item.classList.add('combo-item-ativo');
            campo.setAttribute('aria-activedescendant', item.id);

            // Mantem o item destacado visivel sem rolar a pagina inteira.
            const topo = item.offsetTop;
            const base = topo + item.offsetHeight;
            if (topo < lista.scrollTop) lista.scrollTop = topo;
            else if (base > lista.scrollTop + lista.clientHeight)
                lista.scrollTop = base - lista.clientHeight;
        }

        function escolher(indice) {
            const opcao = visiveis[indice];
            if (!opcao) return;
            select.value = opcao.valor;
            campo.value = opcao.rotulo;
            // Avisa quem escuta o <select> (auto-submissao de filtro, contador
            // do lote): atribuir `value` por script nao dispara evento sozinho.
            select.dispatchEvent(new Event('change', { bubbles: true }));
            fechar(false);
        }

        function desenhar(termo) {
            const alvo = comparavel(termo);
            visiveis = opcoes.filter(function (opcao) {
                return alvo === '' || opcao.busca.indexOf(alvo) !== -1;
            });

            lista.textContent = '';

            if (visiveis.length === 0) {
                const vazio = document.createElement('li');
                vazio.className = 'combo-vazio';
                vazio.textContent = 'Nada encontrado.';
                lista.appendChild(vazio);
                marcar(-1);
                return;
            }

            visiveis.forEach(function (opcao, indice) {
                const item = document.createElement('li');
                item.id = opcao.id;
                item.className = 'combo-item';
                item.textContent = opcao.rotulo;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', opcao.valor === select.value ? 'true' : 'false');
                if (opcao.valor === select.value) item.classList.add('combo-item-atual');

                // `mousedown` e nao `click`: o clique so chegaria depois do blur,
                // que ja teria fechado a lista.
                item.addEventListener('mousedown', function (evento) {
                    evento.preventDefault();
                    escolher(indice);
                });
                lista.appendChild(item);
            });

            const atual = visiveis.findIndex(function (opcao) {
                return opcao.valor === select.value;
            });
            marcar(atual >= 0 ? atual : 0);
        }

        function abrir() {
            if (!lista.hidden) return;
            desenhar(campo.value === rotuloDoValor(select.value) ? '' : campo.value);
            lista.hidden = false;
            campo.setAttribute('aria-expanded', 'true');
        }

        function fechar(restaurarTexto) {
            lista.hidden = true;
            campo.setAttribute('aria-expanded', 'false');
            campo.removeAttribute('aria-activedescendant');
            ativo = -1;
            // O texto digitado nao pode sobreviver ao fechamento: ficaria
            // anunciando uma sala que nao e a que o formulario vai enviar.
            if (restaurarTexto) campo.value = rotuloDoValor(select.value);
        }

        campo.value = rotuloDoValor(select.value);

        campo.addEventListener('focus', function () {
            campo.select();
            abrir();
        });

        campo.addEventListener('click', abrir);

        campo.addEventListener('input', function () {
            if (lista.hidden) lista.hidden = false;
            campo.setAttribute('aria-expanded', 'true');
            desenhar(campo.value);
        });

        campo.addEventListener('keydown', function (evento) {
            const tecla = evento.key;

            if (tecla === 'ArrowDown' || tecla === 'ArrowUp') {
                evento.preventDefault();
                if (lista.hidden) {
                    abrir();
                    return;
                }
                if (visiveis.length === 0) return;
                const passo = tecla === 'ArrowDown' ? 1 : -1;
                const proximo = (ativo + passo + visiveis.length) % visiveis.length;
                marcar(proximo);
                return;
            }

            if (tecla === 'Home' || tecla === 'End') {
                if (lista.hidden || visiveis.length === 0) return;
                evento.preventDefault();
                marcar(tecla === 'Home' ? 0 : visiveis.length - 1);
                return;
            }

            if (tecla === 'Enter') {
                // Enter escolhe da lista; nunca envia o formulario por engano.
                if (!lista.hidden) {
                    evento.preventDefault();
                    escolher(ativo);
                }
                return;
            }

            if (tecla === 'Escape') {
                if (!lista.hidden) {
                    evento.stopPropagation();
                    fechar(true);
                }
                return;
            }

            if (tecla === 'Tab') fechar(true);
        });

        campo.addEventListener('blur', function () {
            fechar(true);
        });
    }

    document.querySelectorAll('select[data-buscavel]').forEach(function (select) {
        if (select.options.length >= MINIMO_PARA_BUSCA) tornarBuscavel(select);
    });
})();
