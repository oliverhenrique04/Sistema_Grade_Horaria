/**
 * Regras do painel de corredor (TVs dos blocos).
 *
 * Entrega a view pronta: nenhuma decisao (faixa do dia, compactacao, descarte
 * do que ja terminou, paginacao) sobra para o EJS.
 *
 * Quatro regras carregam o desenho inteiro:
 *
 * 1. A FAIXA DO DIA SAI DO RELOGIO, nao do turno da turma. No banco real o
 *    turno "Matutino" tem horarios ate 18:10 e o "Noturno" comeca 13:50 — o
 *    turno diz a que grade a turma pertence, nao a que horas a aula acontece.
 * 2. A COMPACTACAO ACONTECE DUAS VEZES: uma aula compartilhada chega repetida
 *    uma vez por turma que a cursa, e uma disciplina de tres horarios chega em
 *    tres linhas de 50 minutos. Vira uma linha so, "08:00 - 10:40".
 * 3. A ORDEM E POR RELEVANCIA DIANTE DO RELOGIO, e nao cronologica. O quadro
 *    existe para responder "para onde eu vou agora?": o que ainda vai comecar
 *    vem primeiro, o que esta acontecendo depois, o que acabou por ultimo.
 * 4. AULA ENCERRADA SO OCUPA ESPACO ENQUANTO SOBRA ESPACO. Se a faixa nao cabe
 *    numa pagina, o que ja acabou sai da frente do que ainda vai acontecer.
 */
const repositorio = require('../repositories/painelRepository');
const { nomeDoDia, siglaDoDia, DIAS } = require('../utils/dias');
const { agruparPorBloco, blocoDoLocal } = require('../utils/blocos');

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
 * Faixas de relevancia. O numero e a ordem em que aparecem no quadro.
 *
 * A separacao e por "o que eu faco com esta linha": o que ainda vai comecar
 * move gente pelo corredor, o que esta acontecendo apenas diz que a sala esta
 * ocupada, e o que acabou nao pede nada de ninguem.
 */
const POR_VIR = 0;
const ACONTECENDO = 1;
const ENCERRADA = 2;

const RELEVANCIA = {
    breve: POR_VIR,
    depois: POR_VIR,
    agora: ACONTECENDO,
    terminando: ACONTECENDO,
    fim: ENCERRADA,
};

/** Grupos de sala, na ordem em que aparecem. */
const SALA_DE_BLOCO = 0;
const SALA_SEM_BLOCO = 1;
const SEM_SALA = 2;

/** Numero de sala ausente. Finito de proposito: `Infinity - Infinity` e NaN. */
const SEM_NUMERO = Number.MAX_SAFE_INTEGER;

/**
 * Sala como chave de ordenacao: primeiro as salas de bloco (letra, depois
 * numero), depois os ambientes que nao seguem a convencao ("Lab 01",
 * "Skill Lab") e, por ultimo, as aulas ainda sem sala.
 *
 * O grupo e um NUMERO, e nao uma letra sentinela: `localeCompare` ignora
 * nao-caracteres, entao `'￾'.localeCompare('C')` devolve -1 e o "Lab 01"
 * subiria para o topo em vez de descer para o fim.
 *
 * O numero sai da PRIMEIRA ocorrencia no nome, que e o que le "310/312 D" como
 * o par do 310. "Lab 02/211 C" fica ordenado por 2, e nao por 211 — e um local
 * entre os 66 em uso, e nenhuma regra mais esperta acerta os dois casos.
 *
 * @param {string|null} nome
 * @returns {[number, string, number, string]} grupo, bloco, numero, nome
 */
const chaveSala = (nome) => {
    if (!nome) return [SEM_SALA, '', SEM_NUMERO, ''];

    const bloco = blocoDoLocal(nome);
    const numero = /(\d+)/.exec(nome);

    return [
        bloco ? SALA_DE_BLOCO : SALA_SEM_BLOCO,
        bloco || '',
        numero ? Number(numero[1]) : SEM_NUMERO,
        nome,
    ];
};

/**
 * Desempate de todas as faixas: sala, depois curso, turma e disciplina.
 *
 * A sala vem antes do curso porque e o "portao" do painel — a unica informacao
 * que faz alguem mudar de direcao no corredor —, e porque e a coluna alinhada a
 * direita, que so se le de relance se for monotonica.
 *
 * A DISCIPLINA fecha a cadeia para que a ordem seja determinada pelo conteudo, e
 * nunca pela ordem de chegada do banco. Sem ela sobra empate real: a turma
 * gerencial oferta duas disciplinas no mesmo horario e na mesma sala, e PSI07M1
 * tem "Estagio Supervisionado Basico I" e "Psicoterapia Infantil" as 08:00 na
 * 303 C. Medido: em 710 momentos as duas trocavam de lugar conforme a ordem das
 * linhas cruas — a TV mostraria uma ou outra em cima a cada recarga.
 */
const compararSala = (a, b) => {
    const [grupoA, blocoA, numeroA, nomeA] = chaveSala(a.local);
    const [grupoB, blocoB, numeroB, nomeB] = chaveSala(b.local);

    return (
        grupoA - grupoB ||
        blocoA.localeCompare(blocoB) ||
        numeroA - numeroB ||
        nomeA.localeCompare(nomeB) ||
        (a.turmas[0]?.curso || '').localeCompare(b.turmas[0]?.curso || '') ||
        (a.turmas[0]?.codigo || '').localeCompare(b.turmas[0]?.codigo || '') ||
        (a.disciplina || '').localeCompare(b.disciplina || '')
    );
};

/**
 * Ordena a faixa por relevancia diante do relogio.
 *
 * A ordem cronologica pura vem do painel de voo, mas la o voo que partiu SAI do
 * quadro — e aqui ele fica. Sem esta funcao o passado ocupa o topo (medido: em
 * 22% dos momentos a primeira linha ja estava encerrada) e a proxima aula, a
 * unica que move alguem, cai em media na 9a linha e as vezes fora da 1a pagina.
 *
 * Dentro de cada faixa, a ordem que serve aquela faixa:
 *
 * - POR VIR: hora de inicio crescente. E a fila do futuro, a mais proxima na
 *   frente.
 * - ACONTECENDO: sala. A hora de inicio ja passou e nao orienta ninguem; a sala
 *   orienta, e a coluna vira um mapa do andar. "Terminando" nao ganha faixa
 *   propria: para quem esta no corredor a sala continua ocupada, e separar as
 *   duas quebraria a coluna de salas em duas sequencias. O rotulo da linha
 *   ("Termina 10:40") ja carrega a nuance.
 * - ENCERRADA: hora de termino decrescente, para a que acabou agora ficar junto
 *   do que ainda vive.
 *
 * Com `agora = -1` nada comecou: tudo cai em POR_VIR e a ordem se reduz a
 * cronologica. E o que o painel de amanha precisa, sem nenhum caso especial.
 *
 * @param {Array<object>} blocos
 * @param {number} agora minutos desde a meia-noite
 * @returns {Array<object>} novo array, ordenado
 */
const ordenarPorRelevancia = (blocos = [], agora) =>
    [...blocos].sort((a, b) => {
        const faixaA = RELEVANCIA[situacaoDe(a, agora)];
        const faixaB = RELEVANCIA[situacaoDe(b, agora)];

        if (faixaA !== faixaB) return faixaA - faixaB;
        if (faixaA === POR_VIR) return a.inicio - b.inicio || compararSala(a, b);
        if (faixaA === ENCERRADA) return b.fim - a.fim || compararSala(a, b);
        return compararSala(a, b) || a.fim - b.fim;
    });

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
        // O ponto no selo marca a aula viva: a que acontece agora, a que esta
        // terminando e a que comeca em breve. Ja se chamou `pulsa`, de quando
        // ele piscava; o painel nao anima mais nada (ver painel.css).
        ponto: situacao === 'agora' || situacao === 'terminando' || situacao === 'breve',
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

    // O recorte por bloco vira lista de salas na CONSULTA, e nao na gravacao:
    // assim um bloco que ganha uma sala nova passa a mostra-la sozinho.
    const doBloco = await repositorio.locaisDosBlocos({
        campusId: recorte.campusId,
        blocos: recorte.blocos,
    });
    const locais = [...new Set([...(recorte.locaisIds || []), ...doBloco])];

    const consulta = {
        periodoId: Number(periodo.id),
        campusId: recorte.campusId,
        cursosIds: recorte.cursosIds,
        turmasIds: recorte.turmasIds,
        turnosIds: recorte.turnosIds,
        diasIds: recorte.dias,
        locaisIds: locais.length > 0 ? locais : undefined,
        incluirSemLocal: recorte.incluirSemLocal,
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

    // O relogio que vale para ordem, poda e situacao. Amanha nada comecou
    // ainda: `-1` faz de tudo futuro, e a ordem por relevancia se reduz a
    // cronologica sem nenhum caso especial.
    const agora = amanha ? -1 : relogio.minutos;

    const daFaixa = ordenarPorRelevancia(escolha.blocos, agora);
    // Amanha nada terminou ainda: apara so faz sentido contra o relogio de hoje.
    const visiveis = amanha ? daFaixa : aparar(daFaixa, agora, capacidade);
    const paginas = paginar(visiveis, capacidade).map((pagina) =>
        pagina.map((bloco) => paraLinha(bloco, agora))
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
const VAZIO = { cursos: [], turmas: [], turnos: [], blocos: [], dias: DIAS };

const opcoesDoGerador = async ({ campusId } = {}, podeVerCampus = () => true) => {
    const periodo = await repositorio.periodoAtual();
    if (!periodo) return { ...VAZIO, periodo: null, campus: [], campusEscolhido: null };

    const periodoId = Number(periodo.id);
    const campus = (await repositorio.listarCampus({ periodoId })).filter((item) =>
        podeVerCampus(Number(item.id))
    );

    const escolhido = campus.find((item) => Number(item.id) === Number(campusId)) || null;
    if (!escolhido) return { ...VAZIO, periodo, campus, campusEscolhido: null };

    const alvo = { periodoId, campusId: Number(escolhido.id) };
    const [cursos, turmas, turnos, locais] = await Promise.all([
        repositorio.listarCursos(alvo),
        repositorio.listarTurmas(alvo),
        repositorio.listarTurnos(alvo),
        repositorio.listarLocais({ campusId: Number(escolhido.id) }),
    ]);

    return {
        periodo,
        campus,
        campusEscolhido: escolhido,
        cursos,
        turmas,
        turnos,
        dias: DIAS,
        blocos: agruparPorBloco(locais),
    };
};

/**
 * Recorte de um painel salvo, no formato que `montarPainel` espera.
 *
 * Lista vazia vira `undefined` de proposito: no banco, `{}` significa "todos"
 * naquele eixo, e um array vazio chegando ao SQL filtraria por nada.
 *
 * @param {object} painel linha de `paineis`
 * @returns {object}
 */
const recorteDoPainel = (painel) => {
    const lista = (valores) =>
        Array.isArray(valores) && valores.length > 0 ? valores.map(Number) : undefined;

    return {
        campusId: Number(painel.campus_id),
        titulo: painel.titulo,
        blocos:
            Array.isArray(painel.blocos) && painel.blocos.length > 0 ? painel.blocos : undefined,
        locaisIds: lista(painel.locais_ids),
        cursosIds: lista(painel.cursos_ids),
        turmasIds: lista(painel.turmas_ids),
        turnosIds: lista(painel.turnos_ids),
        dias: lista(painel.dias),
        incluirSemLocal: painel.incluir_sem_local !== false,
    };
};

/** Painel ativo pelo slug, ja com o recorte resolvido. */
const painelPorSlug = async (slug) => {
    const painel = await repositorio.buscarPainelPorSlug(slug);
    return painel ? { painel, recorte: recorteDoPainel(painel) } : null;
};

/**
 * Resumo legivel do recorte, para a lista do painel administrativo.
 * @param {object} painel
 * @returns {string}
 */
const resumoDoRecorte = (painel) => {
    const partes = [];
    const quantos = (lista, singular, plural) =>
        Array.isArray(lista) && lista.length > 0
            ? `${lista.length} ${lista.length === 1 ? singular : plural}`
            : null;

    if (Array.isArray(painel.blocos) && painel.blocos.length > 0) {
        partes.push(`bloco ${painel.blocos.join(', ')}`);
    }
    [
        [painel.locais_ids, 'sala', 'salas'],
        [painel.cursos_ids, 'curso', 'cursos'],
        [painel.turmas_ids, 'turma', 'turmas'],
        [painel.turnos_ids, 'turno', 'turnos'],
    ].forEach(([lista, s, p]) => {
        const texto = quantos(lista, s, p);
        if (texto) partes.push(texto);
    });

    if (Array.isArray(painel.dias) && painel.dias.length > 0) {
        partes.push(painel.dias.map((dia) => siglaDoDia(dia)).join(' '));
    }

    return partes.length > 0 ? partes.join(' · ') : 'campus inteiro';
};

module.exports = {
    montarPainel,
    opcoesDoGerador,
    recorteDoPainel,
    painelPorSlug,
    resumoDoRecorte,
    densidadeDe,
    compactar,
    colapsarPorAula,
    juntarHorariosSeguidos,
    escolherFaixa,
    situacaoDe,
    ordenarPorRelevancia,
    chaveSala,
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
