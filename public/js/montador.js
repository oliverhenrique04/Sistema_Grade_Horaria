/* Montador de grade horaria — enriquecimento progressivo.

   NADA aqui e necessario para o modulo funcionar: as celulas sao links, as
   acoes sao formularios POST comuns e a verificacao de conflitos tem um botao
   com `formaction` que faz a mesma coisa no servidor. Este arquivo apenas
   evita recarregamentos e ajuda na selecao de periodos consecutivos. */
(function () {
    'use strict';

    const formularioAula = document.getElementById('form-aula');
    const painelConflitos = document.getElementById('painel-conflitos');
    const listaConflitos = document.getElementById('lista-conflitos');

    const ROTULOS = {
        turma: 'Turma',
        professor: 'Professor',
        local: 'Local',
        turno: 'Turno',
        campus: 'Campus',
        inativo: 'Registro inativo',
        dia: 'Dia da semana',
    };

    /** Botao de impressao: so aparece quando ha JavaScript para acioná-lo. */
    document.querySelectorAll('[data-imprimir]').forEach(function (botao) {
        botao.hidden = false;
        botao.addEventListener('click', function () {
            window.print();
        });
    });

    // -----------------------------------------------------------------------
    // Celula vazia: preenche o formulario aberto em vez de recarregar a pagina
    // -----------------------------------------------------------------------
    function formularioEmModoNovo() {
        if (!formularioAula) return false;
        const identificador = formularioAula.querySelector('input[name="aula_id"]');
        return !identificador || !identificador.value;
    }

    function destacarCelula(celula) {
        document.querySelectorAll('.montador-celula-selecionada').forEach(function (item) {
            item.classList.remove('montador-celula-selecionada');
        });
        if (celula) celula.classList.add('montador-celula-selecionada');
    }

    document.querySelectorAll('[data-celula-vazia]').forEach(function (celula) {
        celula.addEventListener('click', function (evento) {
            if (!formularioEmModoNovo()) return;

            const campoDia = document.getElementById('campo-dia');
            const campoHorario = document.getElementById('campo-horario');
            if (!campoDia || !campoHorario) return;

            evento.preventDefault();

            campoDia.value = celula.getAttribute('data-dia');
            campoHorario.value = celula.getAttribute('data-horario');

            marcarPeriodoUnico(celula.getAttribute('data-horario'));
            destacarCelula(celula);
            limparConflitos();

            formularioAula.scrollIntoView({ block: 'center' });
            const disciplina = document.getElementById('campo-disciplina');
            if (disciplina) disciplina.focus();
        });
    });

    // -----------------------------------------------------------------------
    // Periodos consecutivos
    // -----------------------------------------------------------------------
    const periodos = Array.prototype.slice.call(document.querySelectorAll('[data-periodo]'));

    function marcarPeriodoUnico(horarioId) {
        periodos.forEach(function (caixa) {
            caixa.checked = caixa.value === String(horarioId);
        });
    }

    const campoHorarioPrincipal = document.getElementById('campo-horario');
    if (campoHorarioPrincipal && periodos.length > 0) {
        campoHorarioPrincipal.addEventListener('change', function () {
            marcarPeriodoUnico(campoHorarioPrincipal.value);
        });
    }

    /* Seleciona a faixa contigua entre o ultimo periodo marcado e o atual
       (clique com Shift), que e o gesto esperado para "periodos seguidos". */
    let ultimoIndice = null;

    periodos.forEach(function (caixa, indice) {
        caixa.addEventListener('click', function (evento) {
            if (evento.shiftKey && ultimoIndice !== null) {
                const inicio = Math.min(ultimoIndice, indice);
                const fim = Math.max(ultimoIndice, indice);
                for (let atual = inicio; atual <= fim; atual += 1) {
                    periodos[atual].checked = true;
                }
            }
            ultimoIndice = indice;
        });
    });

    // -----------------------------------------------------------------------
    // Pre-visualizacao de conflitos (POST /admin/aulas/prever)
    // -----------------------------------------------------------------------
    function limparConflitos() {
        if (!painelConflitos || !listaConflitos) return;
        listaConflitos.innerHTML = '';
        painelConflitos.hidden = true;
    }

    function mostrarConflitos(conflitos) {
        if (!painelConflitos || !listaConflitos) return;

        listaConflitos.innerHTML = '';
        painelConflitos.hidden = false;

        if (conflitos.length === 0) {
            const aviso = document.createElement('p');
            aviso.className = 'montador-conflitos-ok mb-0';
            aviso.textContent = 'Nenhum conflito encontrado para esta aula.';
            listaConflitos.appendChild(aviso);
            return;
        }

        const lista = document.createElement('ul');
        lista.className = 'montador-conflitos-lista';

        conflitos.forEach(function (conflito) {
            const item = document.createElement('li');
            item.className = 'montador-conflito';

            const etiqueta = document.createElement('span');
            etiqueta.className =
                'badge text-bg-danger-subtle text-danger-emphasis border border-danger-subtle';
            etiqueta.textContent = ROTULOS[conflito.tipo] || 'Conflito';

            const texto = document.createElement('span');
            texto.textContent = conflito.mensagem;

            item.appendChild(etiqueta);
            item.appendChild(texto);
            lista.appendChild(item);
        });

        listaConflitos.appendChild(lista);
    }

    function mensagemDeFalha() {
        if (!painelConflitos || !listaConflitos) return;
        listaConflitos.innerHTML = '';
        painelConflitos.hidden = false;

        const aviso = document.createElement('p');
        aviso.className = 'mb-0';
        aviso.textContent =
            'Não foi possível verificar os conflitos agora. Salve normalmente: a verificação também acontece no servidor.';
        listaConflitos.appendChild(aviso);
    }

    document.querySelectorAll('[data-prever]').forEach(function (botao) {
        botao.addEventListener('click', function (evento) {
            const formulario = botao.form;
            if (!formulario || typeof window.fetch !== 'function') return;

            // Sem JavaScript este mesmo botao envia o formulario para
            // /admin/aulas/prever (atributo formaction).
            evento.preventDefault();

            const dados = new URLSearchParams(new FormData(formulario));
            dados.set('formato', 'json');

            const campoToken = formulario.querySelector('input[name="_csrf"]');

            botao.disabled = true;

            window
                .fetch(botao.getAttribute('data-prever'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Accept: 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRF-Token': campoToken ? campoToken.value : '',
                    },
                    body: dados.toString(),
                })
                .then(function (resposta) {
                    if (!resposta.ok) throw new Error('falha na verificação');
                    return resposta.json();
                })
                .then(function (corpo) {
                    mostrarConflitos(Array.isArray(corpo.conflitos) ? corpo.conflitos : []);
                })
                .catch(function () {
                    mensagemDeFalha();
                })
                .then(function () {
                    botao.disabled = false;
                    if (painelConflitos) painelConflitos.focus();
                });
        });
    });

    // -----------------------------------------------------------------------
    // Alocacao em lote: o botao anuncia quantas aulas serao alteradas
    // -----------------------------------------------------------------------
    /* O recorte e aplicado no servidor; esta contagem apenas antecipa o
       resultado para que ninguem precise adivinhar o alcance do que marcou.
       Sem JavaScript o botao continua dizendo "Aplicar" e o POST e o mesmo. */
    (function contagemDoLote() {
        const formulario = document.querySelector('[data-alocacao]');
        const botao = document.querySelector('[data-alocacao-enviar]');
        const fonte = document.getElementById('dados-alocacao');
        if (!formulario || !botao || !fonte) return;

        let aulas;
        try {
            aulas = JSON.parse(fonte.textContent);
        } catch {
            return;
        }
        if (!Array.isArray(aulas) || aulas.length === 0) return;

        /** Valores marcados em um dos eixos. Vazio significa "todos". */
        function marcados(eixo) {
            const caixas = formulario.querySelectorAll(
                '[data-alocacao-filtro="' + eixo + '"]:checked'
            );
            const valores = new Set();
            caixas.forEach(function (caixa) {
                valores.add(Number(caixa.value));
            });
            return valores;
        }

        /* Mesma regra do `aulaService.definirLocalEmLote`: eixos independentes,
           combinados por E, cada um ignorado quando ninguem o marcou. */
        function alcancadas() {
            const disciplinas = marcados('disciplina');
            const dias = marcados('dia');
            const horarios = marcados('horario');
            const vazias = formulario.querySelector('[data-alocacao-filtro="vazias"]');
            const somenteVazias = Boolean(vazias && vazias.checked);

            return aulas.filter(function (aula) {
                if (somenteVazias && !aula.v) return false;
                if (disciplinas.size > 0 && !disciplinas.has(aula.d)) return false;
                if (dias.size > 0 && !dias.has(aula.s)) return false;
                if (horarios.size > 0 && !horarios.has(aula.h)) return false;
                return true;
            }).length;
        }

        function atualizar() {
            const total = alcancadas();
            botao.disabled = total === 0;
            botao.textContent =
                total === 0
                    ? 'Nenhuma aula no recorte'
                    : 'Aplicar a ' + total + (total === 1 ? ' aula' : ' aulas');
        }

        formulario.addEventListener('change', atualizar);
        atualizar();
    })();
})();
