/**
 * Regras do painel de corredor (TVs dos blocos).
 *
 * Entrega a view pronta: nenhuma decisao (faixa do dia, compactacao, descarte
 * do que ja terminou, paginacao) sobra para o EJS.
 *
 * Tres regras carregam o desenho inteiro:
 *
 * 1. A FAIXA DO DIA SAI DO RELOGIO, nao do turno da turma. No banco real o
 *    turno "Matutino" tem horarios ate 18:10 e o "Noturno" comeca 13:50 — o
 *    turno diz a que grade a turma pertence, nao a que horas a aula acontece.
 * 2. A COMPACTACAO ACONTECE DUAS VEZES: uma aula compartilhada chega repetida
 *    uma vez por turma que a cursa, e uma disciplina de tres horarios chega em
 *    tres linhas de 50 minutos. Vira uma linha so, "08:00 - 10:40".
 * 3. AULA ENCERRADA SO OCUPA ESPACO ENQUANTO SOBRA ESPACO. Se a faixa nao cabe
 *    numa pagina, o que ja acabou sai da frente do que ainda vai acontecer.
 */
const repositorio = require('../repositories/painelRepository');
const { nomeDoDia } = require('../utils/dias');
const { agruparPorBloco } = require('../utils/blocos');

/** Fuso da instituicao. O processo pode rodar em UTC; a TV, nunca. */
const FUSO = 'America/Sao_Paulo';

/**
 * Faixas do dia por hora de INICIO da aula, em minutos desde a meia-noite.
 *
 * Os limites saem dos horarios reais cadastrados: a manha termina 12:20, a
 * tarde vai de 13:00 a 18:10 e a noite comeca 18:10. O corte da manha fica em
 * 13:00 (e nao em 12:20) para que o vao do almoco pertenca a manha ate a
 * ultima aula dela terminar — quem passa no corredor as 12:15 ainda quer ver
 * a aula que esta acontecendo.
 */
const FAIXAS = [
    { chave: 'manha', nome: 'Manhã', icone: 'sol', inicio: 0, fim: 780 },
    { chave: 'tarde', nome: 'Tarde', icone: 'entardecer', inicio: 780, fim: 1090 },
    { chave: 'noite', nome: 'Noite', icone: 'lua', inicio: 1090, fim: 1440 },
];

/**
 * Lacuna maxima entre dois horarios para que continuem sendo a mesma aula.
 * O intervalo institucional e de 10 minutos, apos o 3o periodo de cada turno.
 */
const TOLERANCIA_INTERVALO = 10;

/**
 * Quantas linhas cabem numa pagina da TV vertical (1080x1920).
 *
 * Mora aqui, e nao no CSS, porque decide REGRA: quantas paginas existem e se
 * as aulas encerradas precisam sair. O CSS conhece o mesmo numero para dar a
 * altura da linha; `tests/painel.test.js` confere que os dois nao divergem.
 */
const LINHAS_POR_PAGINA = 18;

/** Ate quantos minutos antes uma aula ja aparece como "comeca em breve". */
const ANTECEDENCIA_BREVE = 30;

/** A partir de quantos minutos do fim a aula aparece como "terminando". */
const ANTECEDENCIA_FIM = 12;

/** "19:00:00" ou "19:00" -> 1140 */
const paraMinutos = (valor) => {
    if (!valor) return null;
    const partes = String(valor).split(':');
    return Number(partes[0]) * 60 + Number(partes[1] || 0);
};

/** "2026-08-07" -> "7 de agosto" */
const diaEMes = (data) => {
    const [ano, mes, dia] = String(data).split('-').map(Number);
    return new Date(Date.UTC(ano, mes - 1, dia)).toLocaleDateString('pt-BR', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
    });
};

/** 1140 -> "19:00" */
const paraHora = (minutos) => {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Instante corrente no fuso da instituicao.
 *
 * `new Date().getHours()` devolveria a hora do processo, que em producao pode
 * rodar em UTC — a TV mostraria a faixa errada por tres horas. O calculo passa
 * pelo `Intl`, que tambem acerta o horario de verao se ele voltar.
 *
 * @param {Date} [instante]
 * @returns {{minutos:number, diaSemana:number, data:string}} diaSemana 1..6, 0 = domingo
 */
const agoraLocal = (instante = new Date()) => {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(instante);

    const campo = (tipo) => Number(partes.find((parte) => parte.type === tipo).value);
    const ano = campo('year');
    const mes = campo('month');
    const dia = campo('day');

    // O dia da semana vem de uma data em UTC montada com as partes locais:
    // assim o calendario e o do fuso, sem depender do fuso do processo.
    const diaJs = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();

    return {
        minutos: campo('hour') * 60 + campo('minute'),
        diaSemana: diaJs,
        data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
    };
};

/** Faixa a que pertence uma hora de inicio. */
const faixaDe = (minutos) =>
    FAIXAS.find((faixa) => minutos >= faixa.inicio && minutos < faixa.fim) ||
    FAIXAS[FAIXAS.length - 1];

/**
 * Passo 1 da compactacao: uma aula fisica vira um registro, com a lista de
 * turmas que a cursam. E aqui que a disciplina da turma gerencial, que chega
 * repetida uma vez por turma atendida, volta a ser uma linha so.
 *
 * A lista de turmas e montada ANTES de qualquer filtro de curso ter efeito
 * sobre a exibicao: o filtro decide quais aulas entram no painel, nao quais
 * turmas a linha nomeia. Sem isso, duas TVs vizinhas mostrariam contagens
 * diferentes para a mesma sala no mesmo horario.
 *
 * @param {Array<object>} linhas
 * @returns {Array<object>}
 */
const colapsarPorAula = (linhas = []) => {
    const porAula = new Map();

    linhas.forEach((linha) => {
        const id = Number(linha.aula_id);

        if (!porAula.has(id)) {
            porAula.set(id, {
                aulaId: id,
                diaSemana: Number(linha.dia_semana),
                inicio: paraMinutos(linha.hora_inicio),
                fim: paraMinutos(linha.hora_fim),
                disciplinaId: Number(linha.disciplina_id),
                disciplina: linha.disciplina_nome,
                professorId: linha.professor_id === null ? null : Number(linha.professor_id),
                professor: linha.professor_nome || '',
                localId: linha.local_id === null ? null : Number(linha.local_id),
                local: linha.local_nome || '',
                turmas: [],
            });
        }

        const aula = porAula.get(id);
        const turmaId = Number(linha.turma_id);
        if (aula.turmas.some((turma) => turma.id === turmaId)) return;

        aula.turmas.push({
            id: turmaId,
            codigo: linha.turma_codigo || linha.turma_nome || '',
            curso: linha.curso_sigla || '',
            semestre:
                linha.semestre_curricular === null || linha.semestre_curricular === undefined
                    ? null
                    : Number(linha.semestre_curricular),
        });
    });

    return [...porAula.values()];
};

/**
 * Passo 2 da compactacao: horarios consecutivos da mesma aula viram uma faixa.
 *
 * Duas aulas so se juntam quando tudo coincide — disciplina, professor, local e
 * o CONJUNTO de turmas — e quando a lacuna entre elas cabe no intervalo
 * institucional. Juntar por conteudo, ignorando as turmas, colaria aulas
 * distintas que por acaso tem o mesmo nome no mesmo horario.
 *
 * A juncao nunca atravessa a fronteira de uma faixa do dia: o turno Integral
 * tem 17:20-18:10 e 18:20-19:10 separados por exatos 10 minutos, e um bloco
 * "17:20 - 19:10" seria classificado como tarde pelo inicio e sumiria do
 * quadro da noite enquanto acontece.
 *
 * @param {Array<object>} aulas
 * @returns {Array<object>}
 */
const juntarHorariosSeguidos = (aulas = []) => {
    const chave = (aula) =>
        [
            aula.disciplinaId,
            aula.professorId ?? 'sem',
            aula.localId ?? 'sem',
            aula.turmas
                .map((turma) => turma.id)
                .sort((a, b) => a - b)
                .join(','),
        ].join('|');

    const grupos = new Map();
    aulas.forEach((aula) => {
        const k = chave(aula);
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(aula);
    });

    const blocos = [];

    grupos.forEach((lista) => {
        lista.sort((a, b) => a.inicio - b.inicio);

        let atual = null;
        lista.forEach((aula) => {
            const seguido = atual && aula.inicio - atual.fim <= TOLERANCIA_INTERVALO;
            const mesmaFaixa = atual && faixaDe(atual.inicio).chave === faixaDe(aula.inicio).chave;

            if (seguido && mesmaFaixa) {
                atual.fim = Math.max(atual.fim, aula.fim);
                atual.horarios += 1;
                return;
            }

            atual = { ...aula, horarios: 1 };
            blocos.push(atual);
        });
    });

    return blocos.sort(
        (a, b) =>
            a.inicio - b.inicio ||
            (a.turmas[0]?.curso || '').localeCompare(b.turmas[0]?.curso || '') ||
            (a.turmas[0]?.codigo || '').localeCompare(b.turmas[0]?.codigo || '')
    );
};

const compactar = (linhas) => juntarHorariosSeguidos(colapsarPorAula(linhas));

/**
 * Escolhe a faixa a exibir: a primeira do dia que ainda tenha aula por
 * terminar. A janela vai do primeiro horario com aula ate o fim do ultimo.
 *
 * Consequencia conhecida: das 17:20 as 18:10 a faixa corrente continua sendo a
 * tarde, e as 52 aulas que comecam as 18:10 (o maior lote do dia) ainda nao
 * aparecem. Trocar mais cedo esconderia as aulas em curso de quem esta nelas —
 * a regra pedida foi "ate o fim daquela faixa", e e essa que vale.
 *
 * @param {Array<object>} blocos
 * @param {number} agora minutos desde a meia-noite
 * @returns {{faixa:object, blocos:Array<object>}|null} null com o dia encerrado
 */
const escolherFaixa = (blocos = [], agora) => {
    for (const faixa of FAIXAS) {
        const daFaixa = blocos.filter((bloco) => faixaDe(bloco.inicio).chave === faixa.chave);
        if (daFaixa.length === 0) continue;

        const fimReal = Math.max(...daFaixa.map((bloco) => bloco.fim));
        if (agora < fimReal) return { faixa, blocos: daFaixa };
    }

    return null;
};

/** Primeira faixa com aula, usada quando o painel vira para o proximo dia. */
const primeiraFaixaComAula = (blocos = []) => {
    for (const faixa of FAIXAS) {
        const daFaixa = blocos.filter((bloco) => faixaDe(bloco.inicio).chave === faixa.chave);
        if (daFaixa.length > 0) return { faixa, blocos: daFaixa };
    }
    return null;
};

/**
 * Situacao de um bloco diante do relogio.
 * @returns {'fim'|'terminando'|'agora'|'breve'|'depois'}
 */
const situacaoDe = (bloco, agora) => {
    if (agora >= bloco.fim) return 'fim';
    if (agora >= bloco.inicio) {
        return bloco.fim - agora <= ANTECEDENCIA_FIM ? 'terminando' : 'agora';
    }
    return bloco.inicio - agora <= ANTECEDENCIA_BREVE ? 'breve' : 'depois';
};

/**
 * Aula encerrada so ocupa espaco enquanto sobra espaco.
 *
 * Cabendo tudo numa pagina, o que ja terminou fica: da contexto e nao custa
 * nada. Nao cabendo, sai da frente do que ainda vai acontecer — e com
 * frequencia isso dispensa a paginacao por completo (a tarde de um campus
 * inteiro cai de 2 paginas para 1).
 *
 * Se TUDO ja terminou, o quadro continua mostrando tudo: uma tela vazia diria
 * menos do que a grade encerrada do turno.
 *
 * @param {Array<object>} blocos
 * @param {number} agora
 * @param {number} [capacidade]
 * @returns {Array<object>}
 */
const aparar = (blocos = [], agora, capacidade = LINHAS_POR_PAGINA) => {
    if (blocos.length <= capacidade) return blocos;

    const emCartaz = blocos.filter((bloco) => bloco.fim > agora);
    return emCartaz.length > 0 ? emCartaz : blocos;
};

/**
 * Reparte em paginas equilibradas: 20 linhas viram 10 e 10, nao 18 e 2.
 * @param {Array<object>} blocos
 * @param {number} [capacidade]
 * @returns {Array<Array<object>>}
 */
const paginar = (blocos = [], capacidade = LINHAS_POR_PAGINA) => {
    if (blocos.length === 0) return [[]];

    const total = Math.ceil(blocos.length / capacidade);
    const porPagina = Math.ceil(blocos.length / total);
    const paginas = [];

    for (let inicio = 0; inicio < blocos.length; inicio += porPagina) {
        paginas.push(blocos.slice(inicio, inicio + porPagina));
    }

    return paginas;
};

/**
 * Regime de densidade de uma pagina, escolhido pela altura que cada linha vai
 * receber. A view so carimba a classe; quem decide e aqui.
 *
 * @param {number} quantidade
 * @returns {'escassa'|'folgada'|'cheia'}
 */
const densidadeDe = (quantidade) => {
    if (quantidade <= 6) return 'escassa';
    if (quantidade <= 13) return 'folgada';
    return 'cheia';
};

/** Bloco pronto para a view: sem ids, sem colunas cruas, com rotulos. */
const paraLinha = (bloco, agora) => {
    const situacao = situacaoDe(bloco, agora);

    const rotulos = {
        agora: 'Em aula',
        terminando: `Termina ${paraHora(bloco.fim)}`,
        breve: `Começa ${paraHora(bloco.inicio)}`,
        depois: `Começa ${paraHora(bloco.inicio)}`,
        fim: 'Encerrada',
    };

    return {
        inicio: paraHora(bloco.inicio),
        fim: paraHora(bloco.fim),
        horarios: bloco.horarios,
        disciplina: bloco.disciplina,
        professor: bloco.professor,
        local: bloco.local,
        turmas: bloco.turmas.map((turma) => turma.codigo),
        situacao,
        situacaoRotulo: rotulos[situacao],
        pulsa: situacao === 'agora' || situacao === 'terminando' || situacao === 'breve',
    };
};

/**
 * Monta o painel completo a partir do recorte ja saneado.
 *
 * @param {{campusId?:number, cursosIds?:number[], turmasIds?:number[],
 *          locaisIds?:number[], titulo?:string}} recorte
 * @param {{agora?:Date, capacidade?:number}} [opcoes]
 * @returns {Promise<object>}
 */
const montarPainel = async (recorte = {}, opcoes = {}) => {
    const capacidade = opcoes.capacidade || LINHAS_POR_PAGINA;
    const relogio = agoraLocal(opcoes.agora);

    /**
     * Toda saida tem a mesma forma. A view le sempre as mesmas chaves, e um
     * estado de excecao (sem campus, sem aula) nao pode faltar com uma delas —
     * no EJS isso vira ReferenceError e a TV mostra pagina de erro.
     */
    const moldura = {
        configurar: false,
        vazio: false,
        motivo: null,
        relogio,
        periodo: null,
        titulo: recorte.titulo || '',
        amanha: false,
        diaSemana: relogio.diaSemana,
        diaNome: nomeDoDia(relogio.diaSemana),
        dataRotulo: diaEMes(relogio.data),
        faixa: null,
        janela: null,
        total: 0,
        ocultas: 0,
        densidade: 'escassa',
        paginas: [[]],
    };

    const periodo = await repositorio.periodoAtual();
    if (!periodo) return { ...moldura, configurar: true, motivo: 'periodo' };
    if (!recorte.campusId) return { ...moldura, configurar: true, motivo: 'campus', periodo };

    const consulta = {
        periodoId: Number(periodo.id),
        campusId: recorte.campusId,
        cursosIds: recorte.cursosIds,
        turmasIds: recorte.turmasIds,
        locaisIds: recorte.locaisIds,
    };

    const doDia = async (diaSemana) =>
        compactar(await repositorio.listarAulasDoDia({ ...consulta, diaSemana }));

    let escolha = null;
    let diaSemana = relogio.diaSemana;
    let amanha = false;

    if (diaSemana >= 1 && diaSemana <= 6) {
        escolha = escolherFaixa(await doDia(diaSemana), relogio.minutos);
    }

    // Dia encerrado (ou domingo): vira para o proximo dia letivo do recorte.
    if (!escolha) {
        const dias = await repositorio.listarDiasComAula(consulta);

        for (let passo = 1; passo <= 7 && !escolha; passo += 1) {
            const candidato = ((relogio.diaSemana + passo - 1) % 7) + 1;
            if (!dias.includes(candidato)) continue;

            const proxima = primeiraFaixaComAula(await doDia(candidato));
            if (!proxima) continue;

            escolha = proxima;
            diaSemana = candidato;
            amanha = true;
        }
    }

    if (!escolha) return { ...moldura, vazio: true, periodo };

    const daFaixa = escolha.blocos;
    // Amanha nada terminou ainda: apara so faz sentido contra o relogio de hoje.
    const visiveis = amanha ? daFaixa : aparar(daFaixa, relogio.minutos, capacidade);
    const paginas = paginar(visiveis, capacidade).map((pagina) =>
        pagina.map((bloco) => paraLinha(bloco, amanha ? -1 : relogio.minutos))
    );

    return {
        ...moldura,
        periodo,
        amanha,
        diaSemana,
        diaNome: nomeDoDia(diaSemana),
        dataRotulo: diaEMes(relogio.data),
        faixa: {
            chave: escolha.faixa.chave,
            nome: escolha.faixa.nome,
            icone: escolha.faixa.icone,
        },
        // A janela e a da faixa INTEIRA, nao a das linhas visiveis: o cabecalho
        // nao pode encolher a cada aula que termina.
        janela: {
            inicio: paraHora(Math.min(...daFaixa.map((bloco) => bloco.inicio))),
            fim: paraHora(Math.max(...daFaixa.map((bloco) => bloco.fim))),
        },
        total: daFaixa.length,
        ocultas: daFaixa.length - visiveis.length,
        densidade: densidadeDe(paginas[0].length),
        paginas,
    };
};

/**
 * Listas do gerador de links, ja limitadas ao escopo do usuario.
 *
 * O recorte por campus e conveniencia de listagem, nao controle de acesso: o
 * painel e publico e honra qualquer id valido na URL. O que ele mostra ja
 * estava na consulta publica da grade — a restricao aqui existe para o operador
 * do NAP nao precisar procurar o campus dele numa lista de todos.
 *
 * @param {{campusId?:number}} [filtros]
 * @param {(campusId:number) => boolean} [podeVerCampus]
 * @returns {Promise<object>}
 */
const opcoesDoGerador = async ({ campusId } = {}, podeVerCampus = () => true) => {
    const periodo = await repositorio.periodoAtual();
    if (!periodo) return { periodo: null, campus: [], cursos: [], turmas: [], blocos: [] };

    const periodoId = Number(periodo.id);
    const campus = (await repositorio.listarCampus({ periodoId })).filter((item) =>
        podeVerCampus(Number(item.id))
    );

    const escolhido = campus.find((item) => Number(item.id) === Number(campusId)) || null;
    if (!escolhido)
        return { periodo, campus, campusEscolhido: null, cursos: [], turmas: [], blocos: [] };

    const alvo = { periodoId, campusId: Number(escolhido.id) };
    const [cursos, turmas, locais] = await Promise.all([
        repositorio.listarCursos(alvo),
        repositorio.listarTurmas(alvo),
        repositorio.listarLocais({ campusId: Number(escolhido.id) }),
    ]);

    return {
        periodo,
        campus,
        campusEscolhido: escolhido,
        cursos,
        turmas,
        blocos: agruparPorBloco(locais),
    };
};

module.exports = {
    montarPainel,
    opcoesDoGerador,
    densidadeDe,
    compactar,
    colapsarPorAula,
    juntarHorariosSeguidos,
    escolherFaixa,
    situacaoDe,
    aparar,
    paginar,
    agoraLocal,
    faixaDe,
    paraMinutos,
    paraHora,
    FAIXAS,
    LINHAS_POR_PAGINA,
    TOLERANCIA_INTERVALO,
    FUSO,
};
