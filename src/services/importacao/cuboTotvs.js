/**
 * Interpretacao do cubo de horarios do TOTVS Educacional.
 *
 * Modulo puro: recebe as linhas cruas da planilha e devolve a estrutura
 * academica que o sistema entende (campus, cursos, disciplinas, professores,
 * turmas e aulas), sem tocar no banco. Isso mantem as regras do cubo — que sao
 * as mais sutis de toda a funcionalidade — testaveis isoladamente.
 *
 * ---------------------------------------------------------------------------
 * O QUE O CUBO ENTREGA
 * ---------------------------------------------------------------------------
 * Uma linha por (professor x turma x disciplina x dia x periodo de 50 min). Uma
 * mesma aula aparece repetida quando tem mais de um professor, e cada disciplina
 * compartilhada aparece uma vez pela turma que a oferta e mais uma vez por cada
 * turma que a recebe:
 *
 *   TURMA_GERENCIAL=Sim  GERENCIADA=NAO   CODTURMA=GPDIRM   <- a oferta real
 *   TURMA_GERENCIAL=Nao  GERENCIADA=SIM   CODTURMA=DIR07M1  <- espelho
 *   TURMA_GERENCIAL=Nao  GERENCIADA=SIM   CODTURMA=DIR08M1  <- espelho
 *
 * REGRA CENTRAL: a aula pertence a turma que oferta. Linhas com GERENCIADA=SIM
 * nunca viram aula — elas so revelam quais turmas sao atendidas pela gerencial e
 * de qual curso ela e. Sem isso, a mesma disciplina entraria N vezes na base.
 *
 * ---------------------------------------------------------------------------
 * COMO CADA CAMPO E DERIVADO
 * ---------------------------------------------------------------------------
 *  Campus            FILIAL ("EUROAM - AGUAS CLARAS").
 *  Curso             CODCURSO/CURSO quando existem. A turma gerencial vem sem
 *                    curso: usa-se o curso predominante entre as turmas que ela
 *                    atende e, se ela nao atende nenhuma, a sigla do codigo
 *                    (GPNUTM -> NUT -> Nutricao), conforme o padrao DIR=DIREITO.
 *  Turma             CODTURMA dentro da FILIAL. O mesmo codigo existe nas duas
 *                    filiais como turmas diferentes.
 *  Semestre          digitos do codigo (DIR08M1 -> 8). Turma gerencial e turma
 *                    especial (DIRESPM1) nao tem semestre.
 *  Turno             TURNO DISCIPLINA predominante da turma; a letra do codigo
 *                    (M/N/I/V) e usada como desempate.
 *  Disciplina        CODDISC + DISCIPLINA + CH_DISPLINA.
 *  Professor         CHAPA (matricula) + NOME; TIPO_PROF vira o papel.
 *  Dia e horario     SEMANA + HORAINICIAL/HORAFINAL.
 *  Presencial x EAD  AULAS_SEMANA (ou TOTAL_HORAS / 4,5) — ver abaixo.
 *
 * ---------------------------------------------------------------------------
 * PRESENCIAL E EAD
 * ---------------------------------------------------------------------------
 * As disciplinas sao hibridas: o cubo lista todos os tempos do bloco, mas so
 * parte deles e aula presencial. Quantos, o proprio cubo diz em `AULAS_SEMANA`
 * — que e o numero de aulas presenciais por semana e vale por PROFESSOR (numa
 * clinica com cinco docentes cada linha traz o seu). Para a oferta vale o
 * maior: e o professor que cobre o bloco inteiro.
 *
 * Exportacoes antigas nao trazem a coluna; nelas `TOTAL_HORAS / 4,5` da o mesmo
 * numero (conferido em 2.756 de 2.756 linhas da carga de 06/08).
 *
 * QUAIS tempos sao presenciais o cubo nao diz — so quantos. Duas regras
 * resolvem, nesta ordem:
 *
 *  1. Ha tempos que nunca recebem o encontro presencial:
 *     - as 18:10, porque o turno da noite abre as 19:00;
 *     - as 07:10, exceto em Odontologia, que comeca cedo;
 *     - o SABADO inteiro (ver abaixo).
 *  2. Do que sobra, ficam presenciais os ULTIMOS tempos do bloco, na
 *     quantidade que `AULAS_SEMANA` indicar. Os demais viram EAD.
 *
 * O sabado entrou na regra 1 na exportacao de 08/08/2026, que passou a repetir
 * quase todo bloco no sabado — mesmos horarios, mesmo professor, `Presencial` —
 * como o tempo alternativo da aula quinzenal. Sao 446 das 515 ofertas. Sem a
 * regra, a ordenacao por dia poe o sabado por ULTIMO, ele vence o desempate da
 * regra 2 e leva o encontro presencial junto: mediu-se uma turma com 14 das 18
 * aulas no sabado e CINCO disciplinas as 08:00 do mesmo sabado. O tempo de dia
 * util e que descreve a grade; o de sabado e a repeticao.
 *
 * As aulas EAD sao gravadas INATIVAS: continuam rastreaveis pela origem, nao
 * aparecem na grade e nao entram no calculo de conflito.
 *
 * Duas salvaguardas impedem que a regra apague disciplina da grade:
 *  - oferta sem `AULAS_SEMANA` (professor que nao compoe salario) fica toda
 *    presencial;
 *  - oferta cujos tempos caem TODOS em tempo de EAD — inclusive a que so tem
 *    sabado — fica toda presencial.
 * Ambas viram aviso na previa.
 */
const { texto, chave, titulo, limitar } = require('../../utils/textos');
const { valorDaSigla, nomeDoDia } = require('../../utils/dias');

/** Colunas exigidas na planilha. Sem qualquer uma delas a carga nao faz sentido. */
const COLUNAS_OBRIGATORIAS = [
    'FILIAL',
    'CHAPA',
    'NOME',
    'HORAINICIAL',
    'HORAFINAL',
    'DISCIPLINA',
    'TURNO DISCIPLINA',
    'TURMA_GERENCIAL',
    'GERENCIADA',
    'CODTURMA',
    'IDTURMADISC',
    'CODDISC',
    'SEMANA',
];

/** Nomes de dia usados pelo cubo. */
const DIAS_DA_SEMANA = {
    DOMINGO: null,
    'SEGUNDA-FEIRA': 1,
    'TERCA-FEIRA': 2,
    'QUARTA-FEIRA': 3,
    'QUINTA-FEIRA': 4,
    'SEXTA-FEIRA': 5,
    SABADO: 6,
};

/** TURNO DISCIPLINA -> slug do turno cadastrado. */
const TURNOS = {
    MATUTINO: 'matutino',
    VESPERTINO: 'vespertino',
    INTEGRAL: 'integral',
    NOTURNO: 'noturno',
};

/** Letra de turno no codigo da turma -> slug. */
const TURNO_PELA_LETRA = { M: 'matutino', V: 'vespertino', I: 'integral', N: 'noturno' };

/** TIPO_PROF -> papel em `aula_professores`. */
const PAPEIS = {
    TITULAR: 'titular',
    COORDENADOR: 'coordenador',
    SUBSTITUTO: 'substituto',
};

/** Ordem de prioridade para eleger o professor principal da aula. */
const PRIORIDADE_PAPEL = { titular: 0, coordenador: 1, substituto: 2, outro: 3 };

/** TIPO_TUMA -> modalidade da aula. */
const MODALIDADES = { PRESENCIAL: 'presencial', EAD: 'ead', HIBRIDO: 'hibrido' };

/** Prefixo das turmas gerenciais no TOTVS. */
const PREFIXO_GERENCIAL = 'GP';

/** Uma aula presencial por semana equivale a este tanto de `TOTAL_HORAS`. */
const HORAS_POR_AULA_SEMANAL = 4.5;

/** Nenhuma aula presencial comeca as 18:10 — o turno da noite abre as 19:00. */
const HORARIO_EAD_NOTURNO = '18:10';

/** Nem as 07:10, salvo nos cursos que realmente comecam nesse horario. */
const HORARIO_EAD_DIURNO = '07:10';

/**
 * Nem no sabado: desde a exportacao de 08/08/2026 o cubo repete o bloco no
 * sabado como tempo alternativo da aula quinzenal (ver o cabecalho do arquivo).
 */
const DIA_EAD = 6;

/** Siglas de curso que comecam as 07:10. */
const SIGLAS_INICIO_CEDO = new Set(['ODO']);

/**
 * Converte "HH:MM" (ou a fracao de dia que o Excel usa para horas) em minutos.
 * @param {any} valor
 * @returns {number|null}
 */
const paraMinutos = (valor) => {
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        // Excel guarda hora como fracao de um dia (0,5 = 12:00).
        if (valor >= 0 && valor < 1) return Math.round(valor * 24 * 60);
        return null;
    }

    const bruto = texto(valor);
    const partes = /^(\d{1,2})[:h.](\d{2})/.exec(bruto);
    if (!partes) return null;

    const horas = Number(partes[1]);
    const minutos = Number(partes[2]);
    if (horas > 23 || minutos > 59) return null;

    return horas * 60 + minutos;
};

/**
 * Minutos desde a meia-noite em "HH:MM".
 * @param {number} minutos
 * @returns {string}
 */
const paraHora = (minutos) => {
    const horas = String(Math.floor(minutos / 60)).padStart(2, '0');
    const resto = String(minutos % 60).padStart(2, '0');
    return `${horas}:${resto}`;
};

/**
 * Converte "10/08/2026" em Date (meio-dia UTC evita deslocamento de fuso).
 * @param {any} valor
 * @returns {Date|null}
 */
const paraData = (valor) => {
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;

    const bruto = texto(valor);
    const brasileira = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruto);
    if (brasileira) {
        return new Date(Date.UTC(+brasileira[3], +brasileira[2] - 1, +brasileira[1], 12));
    }

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12));

    return null;
};

/**
 * Numero inteiro positivo, ou null.
 * @param {any} valor
 * @returns {number|null}
 */
const inteiroPositivo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
};

/**
 * Reduz "Sim"/"SIM"/"S"/"1" a booleano.
 * @param {any} valor
 * @returns {boolean}
 */
const ehSim = (valor) => ['SIM', 'S', '1', 'TRUE'].includes(chave(valor));

/**
 * O codigo e de uma turma gerencial?
 * @param {string} codigo
 * @returns {boolean}
 */
const codigoGerencial = (codigo) => chave(codigo).startsWith(PREFIXO_GERENCIAL);

/**
 * Semestre curricular embutido no codigo da turma.
 * "DIR08M1" -> 8. "DIRESPM1", "GPDIRM" e afins nao tem semestre.
 * @param {string} codigo
 * @returns {number|null}
 */
const semestreDoCodigo = (codigo) => {
    const partes = /^[A-Z]{2,5}(\d{1,2})[MNIV]\d*$/.exec(chave(codigo));
    if (!partes) return null;
    const semestre = Number(partes[1]);
    return semestre >= 1 && semestre <= 20 ? semestre : null;
};

/**
 * Letra de turno embutida no codigo da turma ("DIR08M1" -> matutino).
 * @param {string} codigo
 * @returns {string|null}
 */
const turnoDoCodigo = (codigo) => {
    const partes = /^[A-Z]{2,7}\d{0,2}([MNIV])\d*$/.exec(chave(codigo));
    return partes ? TURNO_PELA_LETRA[partes[1]] : null;
};

/**
 * Sigla do curso embutida no codigo da turma, ja sem o prefixo das gerenciais.
 * "DIR08M1" -> "DIR"; "GPDIRM" -> "DIR"; "GPESPDIRM" -> "ESPDIR".
 * @param {string} codigo
 * @returns {string}
 */
const siglaDoCodigo = (codigo) => {
    let bruto = chave(codigo);
    if (bruto.startsWith(PREFIXO_GERENCIAL)) bruto = bruto.slice(PREFIXO_GERENCIAL.length);

    const partes = /^([A-Z]+)/.exec(bruto);
    if (!partes) return '';

    const letras = partes[1];

    // Nas gerenciais o turno vem colado na sigla ("DIRM", "ODOI"): a ultima
    // letra so e descartada quando sobram ao menos tres, que e o tamanho minimo
    // das siglas de curso usadas pela instituicao.
    if (letras.length > 3 && /[MNIV]$/.test(letras)) return letras.slice(0, -1);

    return letras;
};

/**
 * Numero de aulas presenciais por semana declarado na linha.
 *
 * `AULAS_SEMANA` e a coluna nova do cubo. Exportacoes anteriores nao a trazem e
 * caem no `TOTAL_HORAS`, que e sempre multiplo de 4,5 — uma aula semanal.
 *
 * @param {Record<string, any>} bruta linha crua da planilha
 * @returns {number|null}
 */
const aulasPresenciaisDaLinha = (bruta) => {
    const direto = inteiroPositivo(bruta.AULAS_SEMANA);
    if (direto !== null) return direto;

    const horas = Number(bruta.TOTAL_HORAS);
    if (!Number.isFinite(horas) || horas <= 0) return null;

    const aulas = horas / HORAS_POR_AULA_SEMANAL;
    return Number.isInteger(aulas) && aulas > 0 ? aulas : null;
};

/**
 * O curso da turma comeca as 07:10?
 * @param {object} turma acumulador da turma, ja com `curso` resolvido
 * @returns {boolean}
 */
const comecaCedo = (turma) => {
    if (!turma) return false;
    const curso = turma.curso || {};
    if (SIGLAS_INICIO_CEDO.has(chave(curso.sigla || siglaDoCodigo(turma.codigo)))) return true;
    return chave(curso.nome).includes('ODONTOLOG');
};

/**
 * O tempo e sempre EAD, independente do que `AULAS_SEMANA` disser?
 * @param {object} turma
 * @param {{diaSemana:number, horaInicio:string}} tempo dia e hora "HH:MM"
 * @returns {boolean}
 */
const tempoSempreEad = (turma, { diaSemana, horaInicio }) => {
    if (diaSemana === DIA_EAD) return true;
    if (horaInicio === HORARIO_EAD_NOTURNO) return true;
    if (horaInicio === HORARIO_EAD_DIURNO) return !comecaCedo(turma);
    return false;
};

/**
 * Elemento mais frequente de uma lista (o primeiro a alcancar o topo vence).
 * @param {any[]} valores
 * @returns {any|null}
 */
const predominante = (valores) => {
    const contagem = new Map();
    let vencedor = null;
    let melhor = 0;

    valores.forEach((valor) => {
        if (valor === null || valor === undefined || valor === '') return;
        const total = (contagem.get(valor) || 0) + 1;
        contagem.set(valor, total);
        if (total > melhor) {
            melhor = total;
            vencedor = valor;
        }
    });

    return vencedor;
};

/**
 * Normaliza uma linha crua da planilha.
 * @param {Record<string, any>} bruta
 * @returns {object}
 */
const normalizarLinha = (bruta) => {
    const minutoInicio = paraMinutos(bruta.HORAINICIAL);
    const minutoFim = paraMinutos(bruta.HORAFINAL);
    const papel = PAPEIS[chave(bruta.TIPO_PROF)] || 'outro';

    return {
        linha: bruta.__linha,
        filial: texto(bruta.FILIAL),
        chapa: texto(bruta.CHAPA),
        professorNome: texto(bruta.NOME),
        papel,
        minutoInicio,
        minutoFim,
        horaInicio: minutoInicio === null ? '' : paraHora(minutoInicio),
        horaFim: minutoFim === null ? '' : paraHora(minutoFim),
        disciplinaCodigo: texto(bruta.CODDISC),
        disciplinaNome: texto(bruta.DISCIPLINA),
        cargaHoraria: inteiroPositivo(bruta.CH_DISPLINA),
        aulasPresenciais: aulasPresenciaisDaLinha(bruta),
        turnoSlug: TURNOS[chave(bruta['TURNO DISCIPLINA'])] || null,
        cursoNome: texto(bruta.CURSO),
        cursoCodigo: texto(bruta.CODCURSO),
        modalidade: MODALIDADES[chave(bruta.TIPO_TUMA)] || 'presencial',
        gerencial: ehSim(bruta.TURMA_GERENCIAL),
        gerenciada: ehSim(bruta.GERENCIADA),
        codigoTurma: texto(bruta.CODTURMA).toUpperCase(),
        codigoTurmaGerencial: texto(bruta.CODTURMA_GERENCIAL).toUpperCase(),
        ofertaId: texto(bruta.IDTURMADISC),
        ofertaGerencial: texto(bruta.IDTURMADISC_GEREN),
        diaSemana: DIAS_DA_SEMANA[chave(bruta.SEMANA)] ?? valorDaSigla(bruta.SEMANA),
        dataInicio: paraData(bruta.DTINICIO_DISCIPLINA),
        dataFim: paraData(bruta.DTFIM_DISCIPLINA),
    };
};

/** Identificador interno da turma dentro de uma carga: filial + codigo. */
const chaveTurma = (filial, codigo) => `${chave(filial)}::${chave(codigo)}`;

/**
 * Monta o dicionario sigla -> curso a partir das linhas que trazem CODCURSO.
 * @param {object[]} linhas
 * @returns {Map<string, {codigo:string, nome:string, sigla:string}>}
 */
const mapearCursosPorSigla = (linhas) => {
    const porSigla = new Map();

    linhas.forEach((linha) => {
        if (!linha.cursoCodigo && !linha.cursoNome) return;
        const sigla = siglaDoCodigo(linha.codigoTurma);
        if (!sigla || porSigla.has(sigla)) return;
        porSigla.set(sigla, {
            codigo: linha.cursoCodigo,
            nome: linha.cursoNome,
            sigla,
        });
    });

    return porSigla;
};

/**
 * Curso de uma turma, na ordem de confianca descrita no topo do arquivo.
 * @param {object} turma acumulador da turma
 * @param {Map<string, object>} cursosPorSigla
 * @returns {{codigo:string, nome:string, sigla:string}|null}
 */
const resolverCurso = (turma, cursosPorSigla) => {
    // 1. O proprio cubo informou o curso da turma.
    const informado = predominante(turma.cursosInformados);
    if (informado) {
        const [codigo, nome] = informado.split('::');
        return { codigo, nome, sigla: siglaDoCodigo(turma.codigo) };
    }

    // 2. Turma gerencial: o curso vem das turmas que ela atende.
    const herdado = predominante(turma.cursosDosMembros);
    if (herdado) {
        const [codigo, nome] = herdado.split('::');
        return { codigo, nome, sigla: siglaDoCodigo(turma.codigo) };
    }

    // 3. Ultimo recurso: a sigla do codigo (DIR -> Direito).
    const sigla = siglaDoCodigo(turma.codigo);
    if (sigla && cursosPorSigla.has(sigla)) return cursosPorSigla.get(sigla);

    // 3b. Codigos compostos (GPESPDIRM): procura uma sigla conhecida dentro dele.
    for (const [conhecida, curso] of cursosPorSigla) {
        if (sigla.includes(conhecida)) return curso;
    }

    return null;
};

/**
 * Interpreta a planilha inteira.
 *
 * @param {Array<Record<string, any>>} linhasBrutas saida de `utils/planilha`
 * @returns {{turmas:object[], disciplinas:object[], professores:object[],
 *            campus:object[], cursos:object[], aulas:object[], avisos:object[],
 *            periodo:{ano:number, semestre:number, codigo:string,
 *                     dataInicio:Date|null, dataFim:Date|null}|null,
 *            totais:object}}
 */
const interpretar = (linhasBrutas = []) => {
    const avisos = [];
    const registrarAviso = (tipo, mensagem, detalhe = null) => {
        avisos.push({ tipo, mensagem, detalhe });
    };

    const linhas = linhasBrutas.map(normalizarLinha);

    // -----------------------------------------------------------------------
    // Descarte de linhas inaproveitaveis
    // -----------------------------------------------------------------------
    const validas = [];
    const invalidas = [];

    linhas.forEach((linha) => {
        const faltando = [];
        if (!linha.filial) faltando.push('FILIAL');
        if (!linha.codigoTurma) faltando.push('CODTURMA');
        if (!linha.disciplinaNome) faltando.push('DISCIPLINA');
        if (!linha.diaSemana) faltando.push('SEMANA');
        if (linha.minutoInicio === null || linha.minutoFim === null) faltando.push('HORARIO');
        if (
            linha.minutoFim !== null &&
            linha.minutoInicio !== null &&
            linha.minutoFim <= linha.minutoInicio
        ) {
            faltando.push('HORARIO');
        }

        if (faltando.length > 0) {
            invalidas.push({ linha: linha.linha, faltando });
            return;
        }

        validas.push(linha);
    });

    if (invalidas.length > 0) {
        registrarAviso(
            'linha_invalida',
            `${invalidas.length} linha(s) ignorada(s) por dados incompletos.`,
            invalidas.slice(0, 20).map((item) => `linha ${item.linha}: ${item.faltando.join(', ')}`)
        );
    }

    // -----------------------------------------------------------------------
    // Turmas
    //
    // UMA TURMA POR GRUPO, e nao uma por codigo gerencial. No cubo, "GPDIRM" e
    // apenas o rotulo do ensalamento: cada oferta dela (IDTURMADISC) agrupa um
    // conjunto proprio de turmas. GPDIRM em Aguas Claras, por exemplo, carrega
    // sete conjuntos distintos — {DIR02M1, DIR03M1}, {DIR04M1, DIR05M1}, ... —
    // que sao turmas conjuntas diferentes, com disciplinas e semestres
    // diferentes. Tratar tudo como uma turma so juntaria numa mesma grade
    // disciplinas do 1o e do 10o semestre.
    //
    // O grupo e identificado pelo CONJUNTO de turmas atendidas (unico dentro da
    // gerencial: 0 colisoes na base real). O codigo usa a turma ancora mais a
    // quantidade de turmas, o que cabe em 40 caracteres e tambem nao colide.
    // -----------------------------------------------------------------------
    const turmas = new Map();

    const obterTurma = (filial, codigo) => {
        const id = chaveTurma(filial, codigo);
        if (!turmas.has(id)) {
            turmas.set(id, {
                id,
                filial,
                codigo,
                gerencial: codigoGerencial(codigo),
                semestre: semestreDoCodigo(codigo),
                turnos: [],
                cursosInformados: [],
                cursosDosMembros: [],
                membros: new Set(),
                gerencialDe: null,
                grupoDe: null,
                totalAulas: 0,
            });
        }
        return turmas.get(id);
    };

    // Passo 1: turmas regulares e o mapa oferta compartilhada -> turmas que a cursam.
    const turmasDaOferta = new Map();

    validas.forEach((linha) => {
        if (linha.gerencial) return;

        const turma = obterTurma(linha.filial, linha.codigoTurma);
        if (linha.cursoCodigo || linha.cursoNome) {
            turma.cursosInformados.push(`${linha.cursoCodigo}::${linha.cursoNome}`);
        }

        if (!linha.gerenciada) {
            // Oferta propria da turma: e este turno que descreve a turma.
            turma.turnos.push(linha.turnoSlug);
            return;
        }

        // Linha espelho: nao vira aula. Diz qual oferta da gerencial esta turma
        // cursa — e e disso que sai a composicao de cada grupo.
        if (!linha.ofertaGerencial) return;

        if (!turmasDaOferta.has(linha.ofertaGerencial)) {
            turmasDaOferta.set(linha.ofertaGerencial, new Set());
        }
        turmasDaOferta.get(linha.ofertaGerencial).add(turma.id);
    });

    // Passo 2: uma turma por grupo. Ofertas com o mesmo conjunto de turmas
    // pertencem ao mesmo grupo e compartilham a turma criada aqui.
    const turmaDoGrupo = new Map();

    /**
     * Turma-grupo correspondente a uma oferta da gerencial.
     * @param {object} linha linha gerencial ja normalizada
     * @returns {object} acumulador da turma
     */
    const obterTurmaDoGrupo = (linha) => {
        const membros = [...(turmasDaOferta.get(linha.ofertaId) || [])].sort();
        const assinatura = `${chave(linha.filial)}::${chave(linha.codigoTurma)}::${membros.join('+')}`;

        if (turmaDoGrupo.has(assinatura)) return turmaDoGrupo.get(assinatura);

        const codigosDosMembros = membros
            .map((ref) => (turmas.get(ref) || {}).codigo)
            .filter(Boolean);

        // Grupo sem turma indicada na planilha mantem o codigo puro do cubo.
        const codigo =
            codigosDosMembros.length === 0
                ? linha.codigoTurma
                : `${linha.codigoTurma}.${codigosDosMembros[0]}.${codigosDosMembros.length}`;

        const turma = obterTurma(linha.filial, codigo);
        turma.gerencial = true;
        turma.grupoDe = linha.codigoTurma;
        turma.membrosDoGrupo = membros;
        turma.codigosDoGrupo = codigosDosMembros;
        turma.semestre = null;
        turmaDoGrupo.set(assinatura, turma);

        membros.forEach((ref) => {
            turma.membros.add(ref);
            const membro = turmas.get(ref);
            if (!membro) return;
            membro.gerencialDe = membro.gerencialDe || turma.id;
            if (membro.cursosInformados.length > 0) {
                turma.cursosDosMembros.push(membro.cursosInformados[0]);
            }
        });

        return turma;
    };

    validas.forEach((linha) => {
        if (!linha.gerencial) return;
        const turma = obterTurmaDoGrupo(linha);
        turma.turnos.push(linha.turnoSlug);
        if (linha.cursoCodigo || linha.cursoNome) {
            turma.cursosInformados.push(`${linha.cursoCodigo}::${linha.cursoNome}`);
        }
        // A aula desta linha pertence a turma gerencial, nao ao codigo gerencial.
        linha.turmaRef = turma.id;
    });

    // Semestre da turma gerencial: quando todas as turmas do grupo sao do mesmo
    // semestre, ele vale para o grupo inteiro. Nos demais casos nao existe
    // semestre unico — e a lista de semestres que descreve o grupo.
    turmas.forEach((turma) => {
        if (!turma.gerencial || !turma.membrosDoGrupo) return;
        const semestres = [
            ...new Set(
                turma.membrosDoGrupo
                    .map((ref) => (turmas.get(ref) || {}).semestre)
                    .filter((semestre) => semestre !== null && semestre !== undefined)
            ),
        ];
        turma.semestresDoGrupo = semestres.sort((a, b) => a - b);
        turma.semestre = semestres.length === 1 ? semestres[0] : null;
    });

    const cursosPorSigla = mapearCursosPorSigla(validas);
    const cursos = new Map();
    const campus = new Map();

    turmas.forEach((turma) => {
        if (!campus.has(chave(turma.filial))) {
            campus.set(chave(turma.filial), { codigoExterno: turma.filial });
        }

        const curso = resolverCurso(turma, cursosPorSigla);
        turma.curso = curso;

        if (curso) {
            const id = curso.codigo || `SIGLA:${curso.sigla}`;
            if (!cursos.has(id)) {
                cursos.set(id, {
                    id,
                    codigo: curso.codigo || null,
                    nome: titulo(curso.nome) || curso.sigla,
                    sigla: curso.sigla || null,
                });
            }
            turma.cursoId = id;
        }

        turma.turnoSlug =
            predominante(turma.turnos) || turnoDoCodigo(turma.codigo) || TURNOS.MATUTINO;
    });

    // Turma sem curso identificado nao pode ser criada: aulas dela viram aviso.
    const turmasSemCurso = [...turmas.values()].filter((turma) => !turma.cursoId);
    if (turmasSemCurso.length > 0) {
        registrarAviso(
            'turma_sem_curso',
            `${turmasSemCurso.length} turma(s) sem curso identificavel foram ignoradas.`,
            turmasSemCurso.slice(0, 20).map((turma) => `${turma.codigo} (${turma.filial})`)
        );
    }

    // -----------------------------------------------------------------------
    // Aulas: apenas as linhas que NAO sao espelho de uma turma gerencial
    // -----------------------------------------------------------------------
    const disciplinas = new Map();
    const professores = new Map();
    const aulas = new Map();

    const efetivas = validas.filter((linha) => !linha.gerenciada);

    efetivas.forEach((linha) => {
        // Linha gerencial ja aponta para a turma gerencial; a comum, para a propria.
        const turma = turmas.get(linha.turmaRef || chaveTurma(linha.filial, linha.codigoTurma));
        if (!turma || !turma.cursoId) return;

        if (linha.disciplinaCodigo && !disciplinas.has(linha.disciplinaCodigo)) {
            disciplinas.set(linha.disciplinaCodigo, {
                codigo: linha.disciplinaCodigo,
                nome: limitar(titulo(linha.disciplinaNome), 150),
                cargaHoraria: linha.cargaHoraria,
                cursos: new Set(),
            });
        }

        const disciplina = linha.disciplinaCodigo ? disciplinas.get(linha.disciplinaCodigo) : null;
        if (disciplina) disciplina.cursos.add(turma.cursoId);

        if (linha.chapa && !professores.has(linha.chapa)) {
            professores.set(linha.chapa, {
                matricula: linha.chapa,
                nome: limitar(titulo(linha.professorNome), 150),
            });
        }

        // Identidade da aula na origem: a oferta (turma+disciplina no TOTVS),
        // o dia e o horario. Estavel entre cargas, independe do professor.
        const origemChave = `${linha.ofertaId}|${linha.diaSemana}|${linha.horaInicio}`;

        if (!aulas.has(origemChave)) {
            aulas.set(origemChave, {
                origemChave,
                ofertaId: linha.ofertaId,
                turmaRef: turma.id,
                disciplinaCodigo: linha.disciplinaCodigo,
                disciplinaNome: disciplina ? disciplina.nome : titulo(linha.disciplinaNome),
                diaSemana: linha.diaSemana,
                horaInicio: linha.horaInicio,
                horaFim: linha.horaFim,
                minutoInicio: linha.minutoInicio,
                minutoFim: linha.minutoFim,
                turnoSlug: linha.turnoSlug || turma.turnoSlug,
                modalidade: linha.modalidade,
                // Presencial ate prova em contrario; a classificacao acontece
                // depois, quando a oferta inteira ja foi lida.
                presencial: true,
                aulasPresenciais: null,
                professores: [],
                linhas: [],
            });
            turma.totalAulas += 1;
        }

        const aula = aulas.get(origemChave);
        aula.linhas.push(linha.linha);

        // `AULAS_SEMANA` vale por professor; para a oferta vale o maior, que e
        // o docente que cobre o bloco inteiro.
        if (linha.aulasPresenciais !== null) {
            aula.aulasPresenciais = Math.max(aula.aulasPresenciais ?? 0, linha.aulasPresenciais);
        }

        if (linha.chapa && !aula.professores.some((item) => item.matricula === linha.chapa)) {
            aula.professores.push({ matricula: linha.chapa, papel: linha.papel });
        }
    });

    // Quem assiste cada aula: numa aula comum, so a propria turma (vinculo
    // implicito); numa aula de turma gerencial, as turmas regulares do grupo.
    aulas.forEach((aula) => {
        const turma = turmas.get(aula.turmaRef);
        aula.turmasAtendidas = turma && turma.membrosDoGrupo ? [...turma.membrosDoGrupo] : [];
    });

    // Professor principal: titular primeiro, depois coordenador e substituto.
    aulas.forEach((aula) => {
        aula.professores.sort(
            (a, b) =>
                (PRIORIDADE_PAPEL[a.papel] ?? 9) - (PRIORIDADE_PAPEL[b.papel] ?? 9) ||
                a.matricula.localeCompare(b.matricula)
        );
        aula.professorPrincipal = aula.professores[0] || null;
    });

    // -----------------------------------------------------------------------
    // Presencial x EAD (ver o cabecalho do arquivo)
    //
    // A decisao e por OFERTA, nao por aula: `AULAS_SEMANA` conta o bloco todo
    // da semana, que pode estar espalhado em mais de um dia.
    // -----------------------------------------------------------------------
    const aulasDaOferta = new Map();
    aulas.forEach((aula) => {
        const grupo = aulasDaOferta.get(aula.ofertaId);
        if (grupo) grupo.push(aula);
        else aulasDaOferta.set(aula.ofertaId, [aula]);
    });

    let totalEad = 0;
    const semQuantidade = [];
    const soEmHorarioEad = [];

    aulasDaOferta.forEach((doGrupo) => {
        const turma = turmas.get(doGrupo[0].turmaRef);

        const ordenadas = [...doGrupo].sort(
            (a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio)
        );

        // Regra 1: os tempos que nunca recebem aula presencial.
        const candidatas = ordenadas.filter((aula) => !tempoSempreEad(turma, aula));

        // Salvaguarda: a oferta inteira cai em tempo de EAD. Marcar tudo como
        // EAD apagaria a disciplina da grade — melhor manter e avisar.
        if (candidatas.length === 0) {
            soEmHorarioEad.push(ordenadas[0]);
            return;
        }

        // Regra 2: dos tempos que sobraram ficam presenciais os ULTIMOS, na
        // quantidade declarada. Sem a quantidade, todos eles ficam.
        const quantidade = ordenadas.reduce(
            (maior, aula) =>
                aula.aulasPresenciais === null
                    ? maior
                    : Math.max(maior ?? 0, aula.aulasPresenciais),
            null
        );

        if (quantidade === null) semQuantidade.push(ordenadas[0]);

        const quantas =
            quantidade === null ? candidatas.length : Math.min(quantidade, candidatas.length);
        const presenciais = new Set(quantas > 0 ? candidatas.slice(-quantas) : []);

        ordenadas.forEach((aula) => {
            if (presenciais.has(aula)) return;
            aula.presencial = false;
            aula.modalidade = 'ead';
            totalEad += 1;
        });
    });

    // -----------------------------------------------------------------------
    // Avisos de qualidade: o que o operador precisa saber antes de gravar
    // -----------------------------------------------------------------------
    // Disciplinas simultaneas do ponto de vista do ALUNO: contam tanto as aulas
    // proprias da turma quanto as compartilhadas que ela cursa. Normalmente sao
    // estagios ou optativas em que o aluno escolhe uma; a grade mostra as opcoes
    // lado a lado. O aviso existe para o coordenador conferir, nao para barrar.
    if (totalEad > 0) {
        registrarAviso(
            'aula_ead',
            `${totalEad} aula(s) identificadas como EAD e gravadas inativas — não entram na grade nem no cálculo de conflito.`
        );
    }

    if (semQuantidade.length > 0) {
        registrarAviso(
            'oferta_sem_aulas_semana',
            `${semQuantidade.length} disciplina(s) sem AULAS_SEMANA na planilha — todos os tempos entram como presenciais.`,
            semQuantidade.slice(0, 20).map((aula) => `${aula.disciplinaNome} (${aula.horaInicio})`)
        );
    }

    if (soEmHorarioEad.length > 0) {
        registrarAviso(
            'oferta_so_em_horario_ead',
            `${soEmHorarioEad.length} disciplina(s) só têm tempos às ${HORARIO_EAD_NOTURNO}/${HORARIO_EAD_DIURNO} ou no sábado — mantidas presenciais para não sumirem da grade.`,
            soEmHorarioEad
                .slice(0, 20)
                .map(
                    (aula) =>
                        `${aula.disciplinaNome} (${nomeDoDia(aula.diaSemana)} ${aula.horaInicio})`
                )
        );
    }

    const choques = new Map();

    aulas.forEach((aula) => {
        // O choque e entre aulas presenciais; EAD nao ocupa a agenda do aluno.
        if (!aula.presencial) return;

        const turmaDaAula = turmas.get(aula.turmaRef);
        if (!turmaDaAula) return;

        const alcance = turmaDaAula.gerencial
            ? aula.turmasAtendidas
            : [aula.turmaRef, ...aula.turmasAtendidas];

        new Set(alcance).forEach((ref) => {
            const turma = turmas.get(ref);
            if (!turma || turma.gerencial) return;
            const slot = `${ref}|${aula.diaSemana}|${aula.horaInicio}`;
            if (!choques.has(slot)) choques.set(slot, { turma, aulas: [] });
            choques.get(slot).aulas.push(aula);
        });
    });

    const emChoque = [...choques.values()].filter((item) => item.aulas.length > 1);
    if (emChoque.length > 0) {
        registrarAviso(
            'disciplinas_simultaneas',
            `${emChoque.length} horário(s) com mais de uma disciplina para a mesma turma — em geral estágios ou optativas em que o aluno cursa uma delas.`,
            emChoque.slice(0, 20).map(({ turma, aulas: lista }) => {
                const nomes = lista.map((aula) => aula.disciplinaNome).join(' / ');
                const semestre = turma.semestre ? `${turma.semestre}º sem` : 'sem semestre';
                return `${turma.codigo} (${semestre}) · dia ${lista[0].diaSemana} · ${lista[0].horaInicio}: ${nomes}`;
            })
        );
    }

    const orfas = [...aulas.values()].filter((aula) => {
        const turma = turmas.get(aula.turmaRef);
        return turma && turma.gerencial && aula.turmasAtendidas.length === 0;
    });

    if (orfas.length > 0) {
        registrarAviso(
            'aula_sem_turma_atendida',
            `${orfas.length} aula(s) de turma gerencial sem nenhuma turma regular indicada na planilha — só aparecem na própria gerencial.`,
            orfas.slice(0, 20).map((aula) => `${aula.disciplinaNome} (${aula.horaInicio})`)
        );
    }

    const semSemestre = [...turmas.values()].filter(
        (turma) => !turma.gerencial && turma.semestre === null
    );

    if (semSemestre.length > 0) {
        registrarAviso(
            'turma_sem_semestre',
            `${semSemestre.length} turma(s) sem semestre identificável no código — informe o semestre no cadastro da turma.`,
            semSemestre.slice(0, 20).map((turma) => `${turma.codigo} (${turma.filial})`)
        );
    }

    const semProfessor = [...aulas.values()].filter((aula) => !aula.professorPrincipal);
    if (semProfessor.length > 0) {
        registrarAviso(
            'aula_sem_professor',
            `${semProfessor.length} aula(s) sem professor informado.`
        );
    }

    const semCodigoDisciplina = [...aulas.values()].filter((aula) => !aula.disciplinaCodigo);
    if (semCodigoDisciplina.length > 0) {
        registrarAviso(
            'disciplina_sem_codigo',
            `${semCodigoDisciplina.length} aula(s) com disciplina sem CODDISC (serão casadas pelo nome).`
        );
    }

    // -----------------------------------------------------------------------
    // Periodo letivo sugerido pelas datas da planilha
    // -----------------------------------------------------------------------
    const datasInicio = validas.map((linha) => linha.dataInicio).filter(Boolean);
    const datasFim = validas.map((linha) => linha.dataFim).filter(Boolean);

    let periodo = null;
    if (datasInicio.length > 0) {
        const inicio = new Date(Math.min(...datasInicio.map((data) => data.getTime())));
        const fim =
            datasFim.length > 0
                ? new Date(Math.max(...datasFim.map((data) => data.getTime())))
                : null;
        const ano = inicio.getUTCFullYear();
        const semestre = inicio.getUTCMonth() + 1 <= 6 ? 1 : 2;
        periodo = { ano, semestre, codigo: `${ano}.${semestre}`, dataInicio: inicio, dataFim: fim };
    }

    return {
        periodo,
        campus: [...campus.values()],
        cursos: [...cursos.values()],
        disciplinas: [...disciplinas.values()].map((disciplina) => ({
            ...disciplina,
            cursos: [...disciplina.cursos],
        })),
        professores: [...professores.values()],
        turmas: [...turmas.values()].map((turma) => ({
            id: turma.id,
            filial: turma.filial,
            codigo: turma.codigo,
            gerencial: turma.gerencial,
            // A turma gerencial tem semestre quando todas as suas turmas sao do
            // mesmo; caso contrario `semestresDoGrupo` descreve a composicao.
            semestre: turma.semestre,
            semestresDoGrupo: turma.semestresDoGrupo || [],
            grupoDe: turma.grupoDe || null,
            codigosDoGrupo: turma.codigosDoGrupo || [],
            turnoSlug: turma.turnoSlug,
            cursoId: turma.cursoId || null,
            gerencialDe: turma.gerencialDe,
            membros: [...turma.membros],
            totalAulas: turma.totalAulas,
        })),
        aulas: [...aulas.values()].map((aula) => ({
            ...aula,
            // Semestres que a aula atende, ja distintos e ordenados. Uma
            // disciplina compartilhada costuma servir a dois (7o e 8o).
            semestres: [
                ...new Set(
                    aula.turmasAtendidas
                        .map((ref) => turmas.get(ref))
                        .filter(Boolean)
                        .map((turma) => turma.semestre)
                        .filter((semestre) => semestre !== null)
                ),
            ].sort((a, b) => a - b),
        })),
        avisos,
        totais: {
            linhasLidas: linhas.length,
            linhasValidas: validas.length,
            linhasIgnoradas: invalidas.length,
            linhasEspelho: validas.length - efetivas.length,
            linhasConsideradas: efetivas.length,
            turmas: turmas.size,
            turmasGerenciais: [...turmas.values()].filter((turma) => turma.gerencial).length,
            aulas: aulas.size,
            aulasPresenciais: aulas.size - totalEad,
            aulasEad: totalEad,
            disciplinas: disciplinas.size,
            professores: professores.size,
        },
    };
};

module.exports = {
    interpretar,
    normalizarLinha,
    semestreDoCodigo,
    turnoDoCodigo,
    siglaDoCodigo,
    codigoGerencial,
    aulasPresenciaisDaLinha,
    tempoSempreEad,
    paraMinutos,
    paraHora,
    COLUNAS_OBRIGATORIAS,
    HORARIO_EAD_NOTURNO,
    HORARIO_EAD_DIURNO,
    DIA_EAD,
};
