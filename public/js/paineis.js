/* Formulario dos paineis de TV.

   Tudo aqui e acrescimo: sem JavaScript o formulario funciona inteiro — as
   caixas sao caixas e o `select` de campus tem botao de enviar. O que este
   arquivo faz e tirar o trabalho repetitivo de cima do operador:

     1. o nome vira o endereco (slug) enquanto se digita;
     2. marcar um bloco marca as salas dele, e vice-versa;
     3. cada grupo ganha "marcar todos", "limpar" e a contagem do que esta
        marcado — e as listas longas ganham filtro por texto. */
(function () {
    'use strict';

    const formulario = document.querySelector('[data-painel-form]');
    if (!formulario) return;

    /* ------------------------------------------------- nome vira endereco */

    const campoTitulo = formulario.querySelector('[data-gera-slug]');
    const campoSlug = formulario.querySelector('[data-slug]');

    function comoSlug(valor) {
        return String(valor || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    if (campoTitulo && campoSlug) {
        // Endereco ja preenchido e escolha de alguem: nao se reescreve sozinho,
        // senao a URL de uma TV no ar mudaria ao corrigir um acento no nome.
        let seguirTitulo = campoSlug.value.trim() === '';

        campoSlug.addEventListener('input', function () {
            seguirTitulo = false;
        });

        campoTitulo.addEventListener('input', function () {
            if (seguirTitulo) campoSlug.value = comoSlug(campoTitulo.value);
        });
    }

    /* -------------------------------------------- bloco marca suas salas */

    formulario.querySelectorAll('[data-bloco-grupo]').forEach(function (grupo) {
        const todo = grupo.querySelector('[data-bloco-todo]');
        const salas = Array.prototype.slice.call(grupo.querySelectorAll('[data-bloco-sala]'));
        const abrir = grupo.querySelector('[data-bloco-abrir]');
        const lista = grupo.querySelector('[data-bloco-salas]');

        if (abrir && lista) {
            // Comeca aberto quando ha sala marcada — senao a marcacao ficaria
            // escondida e pareceria perdida.
            const temMarcada = salas.some(function (sala) {
                return sala.checked;
            });
            lista.hidden = !temMarcada;
            abrir.setAttribute('aria-expanded', String(temMarcada));

            abrir.addEventListener('click', function () {
                lista.hidden = !lista.hidden;
                abrir.setAttribute('aria-expanded', String(!lista.hidden));
            });
        }

        if (!todo || salas.length === 0) return;

        todo.addEventListener('change', function () {
            // Marcar o bloco inteiro dispensa as salas: o recorte por letra
            // acompanha sozinho as salas cadastradas depois.
            if (todo.checked) {
                salas.forEach(function (sala) {
                    sala.checked = false;
                });
            }
            atualizarContagens();
        });

        salas.forEach(function (sala) {
            sala.addEventListener('change', function () {
                if (sala.checked) todo.checked = false;
                atualizarContagens();
            });
        });
    });

    /* --------------------------------------- atalhos de cada grupo de chips */

    const grupos = Array.prototype.slice.call(formulario.querySelectorAll('[data-grupo]'));

    function caixasDe(grupo) {
        return Array.prototype.slice.call(grupo.querySelectorAll('input[type="checkbox"]'));
    }

    function visiveis(grupo) {
        return caixasDe(grupo).filter(function (caixa) {
            const chip = caixa.closest('.painel-chip');
            return !chip || !chip.hidden;
        });
    }

    function atualizarContagens() {
        grupos.forEach(function (grupo) {
            const conta = grupo.querySelector('[data-conta]');
            if (!conta) return;

            const total = caixasDe(grupo).length;
            const marcadas = caixasDe(grupo).filter(function (caixa) {
                return caixa.checked;
            }).length;

            conta.textContent = marcadas === 0 ? 'nada marcado = todos' : marcadas + ' de ' + total;
        });
    }

    grupos.forEach(function (grupo) {
        const atalhos = grupo.querySelector('[data-atalhos]');
        if (!atalhos) return;
        atalhos.hidden = false;

        const marcarTodos = atalhos.querySelector('[data-marcar-todos]');
        const limpar = atalhos.querySelector('[data-limpar]');
        const filtrar = atalhos.querySelector('[data-filtrar]');

        if (marcarTodos) {
            marcarTodos.addEventListener('click', function () {
                visiveis(grupo).forEach(function (caixa) {
                    caixa.checked = true;
                });
                atualizarContagens();
            });
        }

        if (limpar) {
            limpar.addEventListener('click', function () {
                caixasDe(grupo).forEach(function (caixa) {
                    caixa.checked = false;
                });
                atualizarContagens();
            });
        }

        if (filtrar) {
            filtrar.addEventListener('input', function () {
                const termo = comoSlug(filtrar.value);

                grupo.querySelectorAll('.painel-chip').forEach(function (chip) {
                    const alvo = comoSlug(chip.dataset.busca || chip.textContent);
                    chip.hidden = termo !== '' && alvo.indexOf(termo) === -1;
                });
            });
        }

        caixasDe(grupo).forEach(function (caixa) {
            caixa.addEventListener('change', atualizarContagens);
        });
    });

    atualizarContagens();
})();
