/**
 * Regras do painel administrativo (dashboard).
 *
 * Responsabilidades:
 *  - traduzir o usuario autenticado em um escopo de consulta (delegando a
 *    `escopoService`, que e a fonte unica da regra de visibilidade);
 *  - decidir quais indicadores o usuario pode ver (`temPermissao(..., 'ler')`);
 *  - montar os rotulos, notas e destaques que a view apenas exibe.
 *
 * Nao existe SQL aqui: as consultas ficam em `dashboardRepository`.
 */
const dashboardRepository = require('../repositories/dashboardRepository');
const escopoService = require('./escopoService');
const { temPermissao } = require('../middlewares/autorizacao');

/**
 * Tipos de pendencia exibidos, na ordem em que aparecem na tela. A ordem vai do
 * que falta preencher (mais comum) ao que esta inconsistente (mais grave).
 */
const TIPOS_PENDENCIA = [
    {
        tipo: 'aula_sem_horario',
        rotulo: 'Aulas sem horário',
        icone: 'fa-hourglass-half',
        descricao: 'Aulas cadastradas que ainda não ocupam um horário do turno.',
    },
    {
        tipo: 'aula_sem_local',
        rotulo: 'Aulas sem local',
        icone: 'fa-location-dot',
        descricao: 'Aulas presenciais ou híbridas que ainda não têm sala definida.',
    },
    {
        tipo: 'turma_duplicada',
        rotulo: 'Turma com duas aulas no mesmo horário',
        icone: 'fa-clone',
        descricao: 'Duas aulas ativas da mesma turma no mesmo dia e horário.',
    },
    {
        tipo: 'professor_sobreposto',
        rotulo: 'Professor em duas aulas ao mesmo tempo',
        icone: 'fa-user-clock',
        descricao: 'Aulas com faixas de horário que se sobrepõem no relógio.',
    },
    {
        tipo: 'local_sobreposto',
        rotulo: 'Local ocupado por duas aulas',
        icone: 'fa-door-closed',
        descricao: 'Ambientes virtuais não entram nesta verificação.',
    },
    {
        tipo: 'turno_divergente',
        rotulo: 'Aula em turno diferente do da turma',
        icone: 'fa-clock-rotate-left',
        descricao: 'O horário escolhido pertence a outro turno.',
    },
    {
        tipo: 'campus_divergente',
        rotulo: 'Local em campus diferente do da turma',
        icone: 'fa-building-circle-exclamation',
        descricao: 'Ambientes virtuais não entram nesta verificação.',
    },
];

/**
 * Converte o usuario autenticado no escopo consumido pelo repository.
 * @param {{perfil?:string, cursosIds?:number[], campusIds?:number[]}|null} usuario
 * @returns {object}
 */
const montarEscopo = (usuario) => ({
    global: escopoService.escopoGlobal(usuario),
    cursosIds: usuario && usuario.perfil === 'coordenador' ? [...(usuario.cursosIds || [])] : null,
    campusIds: usuario && usuario.perfil === 'nap' ? [...(usuario.campusIds || [])] : null,
    turmas: (alias, indiceInicial) => escopoService.filtroTurmas(usuario, alias, indiceInicial),
});

/**
 * O usuario tem perfil restrito e nenhum vinculo cadastrado?
 * Nao e erro: ele ve zeros e uma explicacao do porque.
 * @param {{perfil?:string, cursosIds?:number[], campusIds?:number[]}|null} usuario
 * @returns {boolean}
 */
const semVinculo = (usuario) => {
    if (!usuario) return true;
    if (usuario.perfil === 'coordenador') return (usuario.cursosIds || []).length === 0;
    if (usuario.perfil === 'nap') return (usuario.campusIds || []).length === 0;
    return false;
};

/**
 * Frase curta que explica de onde vem cada numero, exibida como subtitulo.
 * @param {{perfil?:string, cursosIds?:number[], campusIds?:number[]}|null} usuario
 * @returns {string}
 */
const descreverEscopo = (usuario) => {
    if (!usuario) return '';
    if (usuario.perfil === 'admin') return 'Visão global do sistema.';

    if (usuario.perfil === 'coordenador') {
        const total = (usuario.cursosIds || []).length;
        if (total === 0) return 'Nenhum curso vinculado ao seu usuário.';
        return total === 1
            ? 'Números do curso vinculado ao seu usuário.'
            : `Números dos ${total} cursos vinculados ao seu usuário.`;
    }

    if (usuario.perfil === 'nap') {
        const total = (usuario.campusIds || []).length;
        if (total === 0) return 'Nenhum campus vinculado ao seu usuário.';
        return total === 1
            ? 'Números do campus vinculado ao seu usuário.'
            : `Números dos ${total} campus vinculados ao seu usuário.`;
    }

    return '';
};

/**
 * Explicacao exibida quando o usuario nao tem vinculo algum.
 * @param {{perfil?:string}|null} usuario
 * @returns {{titulo:string, descricao:string}|null}
 */
const avisoSemVinculo = (usuario) => {
    if (!usuario || !semVinculo(usuario)) return null;

    if (usuario.perfil === 'coordenador') {
        return {
            titulo: 'Nenhum curso vinculado ao seu usuário',
            descricao:
                'Por isso todos os indicadores estão zerados. Peça a um administrador que vincule os seus cursos.',
        };
    }

    if (usuario.perfil === 'nap') {
        return {
            titulo: 'Nenhum campus vinculado ao seu usuário',
            descricao:
                'Por isso todos os indicadores estão zerados. Peça a um administrador que vincule os seus campus.',
        };
    }

    return {
        titulo: 'Sem escopo de visualização',
        descricao: 'Seu usuário não tem vínculos que permitam exibir os indicadores.',
    };
};

/**
 * Nota de rodape dos cadastros, deixando claro de onde vem a contagem.
 * @param {{perfil?:string}|null} usuario
 * @param {'cadastro'|'aulas'} origem
 * @returns {string}
 */
const notaDeEscopo = (usuario, origem) => {
    if (!usuario || usuario.perfil === 'admin') return 'Cadastro ativo (todo o sistema)';
    if (origem === 'aulas') return 'Presentes nas aulas do seu escopo';
    return usuario.perfil === 'nap' ? 'Nos seus campus' : 'Nos seus cursos';
};

/**
 * Monta a lista de indicadores ja filtrada pelas permissoes de leitura.
 * Um cartao so vira link quando o usuario pode ler o recurso de destino.
 *
 * @param {object} usuario
 * @param {object} dados resumo + cadastros
 * @param {{codigo?:string}|null} periodoAtual
 * @returns {object[]}
 */
const montarIndicadores = (usuario, { resumo, cadastros, periodoAtual }) => {
    const ehNap = Boolean(usuario) && usuario.perfil === 'nap';

    const notaTurmas = periodoAtual
        ? `${resumo.turmas_periodo_atual} no período ${periodoAtual.codigo}`
        : 'Nenhum período letivo marcado como atual';

    const notaSemLocal =
        resumo.aulas_ead_sem_local > 0
            ? `${resumo.aulas_ead_sem_local} aula(s) EAD sem local não entram na conta`
            : 'Somente aulas que precisam de espaço físico';

    const definicoes = [
        {
            chave: 'turmas',
            recurso: 'turmas',
            rotulo: 'Turmas',
            icone: 'fa-users-rectangle',
            valor: resumo.turmas,
            url: '/admin/turmas',
            nota: notaTurmas,
        },
        {
            chave: 'aulas',
            recurso: 'aulas',
            rotulo: 'Aulas',
            icone: 'fa-calendar-days',
            valor: resumo.aulas,
            url: '/admin/aulas',
            nota: 'Aulas ativas das turmas do escopo',
        },
        {
            chave: 'cursos',
            recurso: 'cursos',
            rotulo: 'Cursos',
            icone: 'fa-graduation-cap',
            valor: cadastros.cursos,
            url: '/admin/cursos',
            nota: notaDeEscopo(usuario, 'cadastro'),
        },
        {
            chave: 'disciplinas',
            recurso: 'disciplinas',
            rotulo: 'Disciplinas',
            icone: 'fa-book',
            valor: cadastros.disciplinas,
            url: '/admin/disciplinas',
            nota: notaDeEscopo(usuario, 'aulas'),
        },
        {
            chave: 'professores',
            recurso: 'professores',
            rotulo: 'Professores',
            icone: 'fa-chalkboard-user',
            valor: cadastros.professores,
            url: '/admin/professores',
            nota: notaDeEscopo(usuario, 'aulas'),
        },
        {
            chave: 'locais',
            recurso: 'locais',
            rotulo: 'Locais',
            icone: 'fa-door-open',
            valor: cadastros.locais,
            url: '/admin/locais',
            nota: ehNap ? 'Salas dos seus campus' : notaDeEscopo(usuario, 'cadastro'),
            // Locais e aulas sem local abrem a grade do NAP: e o trabalho dele.
            prioridade: ehNap ? -2 : 6,
        },
        {
            chave: 'aulas_sem_horario',
            recurso: 'aulas',
            rotulo: 'Aulas sem horário',
            icone: 'fa-hourglass-half',
            valor: resumo.aulas_sem_horario,
            url: '/admin/aulas?sem_horario=1',
            nota: 'Precisam ser encaixadas na grade',
            destaque: resumo.aulas_sem_horario > 0,
        },
        {
            chave: 'aulas_sem_local',
            recurso: 'aulas',
            rotulo: 'Aulas sem local',
            icone: 'fa-location-dot',
            valor: resumo.aulas_sem_local,
            url: '/admin/aulas?sem_local=1',
            nota: ehNap ? 'Prioridade do NAP' : notaSemLocal,
            destaque: resumo.aulas_sem_local > 0,
            prioridade: ehNap ? -1 : 8,
        },
    ];

    return (
        definicoes
            .map((indicador, posicao) => ({
                ...indicador,
                valor: Number(indicador.valor) || 0,
                destaque: Boolean(indicador.destaque),
                prioridade: indicador.prioridade === undefined ? posicao : indicador.prioridade,
            }))
            // Esconder um cartao aqui e apenas parte da regra: a rota de destino
            // tambem valida permissao no backend.
            .filter((indicador) => temPermissao(usuario, indicador.recurso, 'ler'))
            .sort((a, b) => a.prioridade - b.prioridade)
    );
};

/**
 * Agrupa as linhas de pendencia devolvidas pelo repository por tipo,
 * preservando a ordem de exibicao e o total real de cada tipo.
 * @param {object[]} linhas
 * @returns {{total:number, grupos:object[]}}
 */
const agruparPendencias = (linhas) => {
    const grupos = TIPOS_PENDENCIA.map((definicao) => {
        const exemplos = linhas.filter((linha) => linha.tipo === definicao.tipo);
        const total = exemplos.length > 0 ? Number(exemplos[0].total) : 0;

        return {
            ...definicao,
            total,
            exemplos,
            ocultos: Math.max(total - exemplos.length, 0),
        };
    }).filter((grupo) => grupo.total > 0);

    const total = grupos.reduce((soma, grupo) => soma + grupo.total, 0);

    return { total, grupos };
};

/**
 * Monta todos os dados do painel respeitando o escopo e as permissoes do
 * usuario. As consultas independentes rodam em paralelo.
 *
 * @param {{perfil?:string, cursosIds?:number[], campusIds?:number[]}|null} usuario
 * @param {{periodoAtual?: object|null, limitePorTipo?: number}} [opcoes]
 * @returns {Promise<object>} dados prontos para a view
 */
const montarPainel = async (usuario, { periodoAtual = null, limitePorTipo } = {}) => {
    const escopo = montarEscopo(usuario);
    const podeVerAulas = temPermissao(usuario, 'aulas', 'ler');

    const [resumo, cadastros, turnos, linhasPendencia] = await Promise.all([
        dashboardRepository.resumoDaGrade(escopo, {
            periodoAtualId: periodoAtual ? periodoAtual.id : null,
        }),
        dashboardRepository.contarCadastros(escopo),
        dashboardRepository.distribuicaoPorTurno(escopo),
        podeVerAulas
            ? dashboardRepository.listarPendencias(escopo, { limitePorTipo })
            : Promise.resolve([]),
    ]);

    const distribuicaoTurnos = turnos.map((turno) => ({
        ...turno,
        turmas: Number(turno.turmas) || 0,
        aulas: Number(turno.aulas) || 0,
    }));

    return {
        periodoAtual,
        escopoVazio: semVinculo(usuario),
        escopoDescricao: descreverEscopo(usuario),
        aviso: avisoSemVinculo(usuario),
        indicadores: montarIndicadores(usuario, { resumo, cadastros, periodoAtual }),
        distribuicaoTurnos,
        totalTurmasNosTurnos: distribuicaoTurnos.reduce((soma, turno) => soma + turno.turmas, 0),
        totalAulasNosTurnos: distribuicaoTurnos.reduce((soma, turno) => soma + turno.aulas, 0),
        pendencias: agruparPendencias(linhasPendencia),
        podeVerAulas,
    };
};

module.exports = { montarPainel, TIPOS_PENDENCIA };
