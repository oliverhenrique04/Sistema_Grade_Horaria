/**
 * Acesso a dados do painel (dashboard).
 *
 * Todo o SQL dos indicadores vive aqui, sempre parametrizado. As contagens sao
 * agrupadas em poucas consultas (`COUNT(*) FILTER (WHERE ...)`) para que o
 * painel nao dispare dezenas de queries sequenciais.
 *
 * ESCOPO: nenhuma funcao decide sozinha o que o usuario enxerga. Todas recebem
 * um objeto `escopo` montado pelo service a partir de `escopoService`:
 *
 *   {
 *     global: boolean,                 // admin: sem restricao
 *     cursosIds: number[] | null,      // preenchido apenas para coordenador
 *     campusIds: number[] | null,      // preenchido apenas para nap
 *     turmas: (alias, indiceInicial) => { sql, parametros, proximoIndice }
 *   }
 *
 * `turmas` devolve o fragmento de WHERE que restringe a tabela `turmas` ao
 * escopo do usuario (contrato de `escopoService.filtroTurmas`). Escopo vazio
 * nao e erro: as consultas simplesmente devolvem zero.
 *
 * Conflitos de professor e de local sao comparados pela FAIXA REAL de horario
 * (`hora_inicio`/`hora_fim`) e nao pelo `horario_turno_id`: o 5o horario do
 * Matutino e o 5o do Integral sao registros diferentes que podem ocupar o mesmo
 * tempo de relogio. Duas faixas se sobrepoem quando
 * `a.hora_inicio < b.hora_fim AND b.hora_inicio < a.hora_fim`.
 */
const db = require('../config/db');
const { novoFiltro } = require('../utils/consulta');

/** Quantos exemplos de cada tipo de pendencia sao listados por padrao. */
const LIMITE_EXEMPLOS = 5;

/**
 * Monta o filtro de turmas ativas ja restrito ao escopo do usuario.
 * @param {object} escopo escopo montado pelo dashboardService
 * @param {string} [alias='t'] alias da tabela `turmas`
 * @returns {import('../utils/consulta').ConstrutorFiltro}
 */
const filtroTurmasAtivas = (escopo, alias = 't') => {
    const filtro = novoFiltro();
    filtro.adicionar(`${alias}.ativo`);

    const fragmento = escopo.turmas(alias, filtro.proximoIndice);
    if (fragmento.sql) {
        filtro.fragmento(fragmento.sql, fragmento.parametros);
    }

    return filtro;
};

const inteiroOuNulo = (valor) => {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : null;
};

/**
 * Contagens de turmas e aulas do escopo, em uma unica consulta.
 *
 * "Aula sem local" considera apenas as aulas que precisam de espaco fisico
 * (modalidade diferente de `ead`); as aulas EAD sem local sao contadas a parte,
 * como informacao, e nunca entram nas pendencias.
 *
 * @param {object} escopo
 * @param {{periodoAtualId?: number|null}} [opcoes]
 * @returns {Promise<{turmas:number, turmas_periodo_atual:number, aulas:number,
 *   aulas_sem_horario:number, aulas_sem_local:number, aulas_ead_sem_local:number}>}
 */
const resumoDaGrade = async (escopo, { periodoAtualId = null } = {}) => {
    const filtro = filtroTurmasAtivas(escopo, 't');
    const indicePeriodo = filtro.proximoIndice;

    const parametros = [...filtro.parametros, inteiroOuNulo(periodoAtualId)];

    const resultado = await db.query(
        `SELECT
                COUNT(DISTINCT t.id)::int AS turmas,
                COUNT(DISTINCT t.id) FILTER (
                    WHERE t.periodo_letivo_id = $${indicePeriodo}::int
                )::int AS turmas_periodo_atual,
                COUNT(a.id)::int AS aulas,
                COUNT(a.id) FILTER (WHERE a.horario_turno_id IS NULL)::int AS aulas_sem_horario,
                COUNT(a.id) FILTER (
                    WHERE a.local_id IS NULL AND a.modalidade <> 'ead'
                )::int AS aulas_sem_local,
                COUNT(a.id) FILTER (
                    WHERE a.local_id IS NULL AND a.modalidade = 'ead'
                )::int AS aulas_ead_sem_local
           FROM turmas t
           LEFT JOIN aulas a ON a.turma_id = t.id AND a.ativo
          ${filtro.where}`,
        parametros
    );

    return resultado.rows[0];
};

/**
 * Contagens dos cadastros (cursos, professores, disciplinas e locais).
 *
 * Regras de escopo:
 *  - admin: totais do cadastro ativo (visao global);
 *  - coordenador: cursos vinculados a ele; professores e disciplinas que
 *    aparecem nas aulas das turmas do escopo; locais dos campus em que ele tem
 *    turmas;
 *  - nap: cursos e demais dados derivados das turmas dos campus vinculados;
 *    locais de TODOS os campus vinculados (manter salas e o trabalho dele).
 *
 * @param {object} escopo
 * @returns {Promise<{cursos:number, professores:number, disciplinas:number, locais:number}>}
 */
const contarCadastros = async (escopo) => {
    if (escopo.global) {
        const resultado = await db.query(
            `SELECT
                    (SELECT COUNT(*) FROM cursos WHERE ativo)::int AS cursos,
                    (SELECT COUNT(*) FROM professores WHERE ativo)::int AS professores,
                    (SELECT COUNT(*) FROM disciplinas WHERE ativo)::int AS disciplinas,
                    (SELECT COUNT(*) FROM locais WHERE ativo)::int AS locais`
        );
        return resultado.rows[0];
    }

    const filtro = filtroTurmasAtivas(escopo, 't');
    const indiceCursos = filtro.proximoIndice;
    const indiceCampus = indiceCursos + 1;

    const parametros = [
        ...filtro.parametros,
        escopo.cursosIds === null ? null : escopo.cursosIds,
        escopo.campusIds === null ? null : escopo.campusIds,
    ];

    const resultado = await db.query(
        `WITH turmas_escopo AS (
                SELECT t.id, t.curso_id, t.campus_id
                  FROM turmas t
                 ${filtro.where}
            ),
            aulas_escopo AS (
                SELECT a.professor_id, a.disciplina_id
                  FROM aulas a
                  JOIN turmas_escopo te ON te.id = a.turma_id
                 WHERE a.ativo
            )
            SELECT
                (SELECT COUNT(*)
                   FROM cursos c
                  WHERE c.ativo
                    AND ($${indiceCursos}::int[] IS NULL OR c.id = ANY($${indiceCursos}::int[]))
                    AND ($${indiceCursos}::int[] IS NOT NULL
                         OR c.id IN (SELECT curso_id FROM turmas_escopo)))::int AS cursos,
                (SELECT COUNT(DISTINCT professor_id)
                   FROM aulas_escopo
                  WHERE professor_id IS NOT NULL)::int AS professores,
                (SELECT COUNT(DISTINCT disciplina_id) FROM aulas_escopo)::int AS disciplinas,
                (SELECT COUNT(*)
                   FROM locais l
                  WHERE l.ativo
                    AND (($${indiceCampus}::int[] IS NOT NULL
                          AND l.campus_id = ANY($${indiceCampus}::int[]))
                         OR ($${indiceCampus}::int[] IS NULL
                             AND l.campus_id IN (SELECT campus_id FROM turmas_escopo))))::int AS locais`,
        parametros
    );

    return resultado.rows[0];
};

/**
 * Distribuicao de turmas e aulas por turno, dentro do escopo.
 * Todos os turnos ativos aparecem, inclusive os zerados (a ausencia tambem
 * informa).
 * @param {object} escopo
 * @returns {Promise<Array<{id:number, nome:string, slug:string, icone:string,
 *   turmas:number, aulas:number}>>}
 */
const distribuicaoPorTurno = async (escopo) => {
    const filtro = filtroTurmasAtivas(escopo, 't');

    const resultado = await db.query(
        `SELECT tu.id,
                tu.nome,
                tu.slug,
                tu.icone,
                tu.ordem,
                COUNT(DISTINCT t.id)::int AS turmas,
                COUNT(a.id)::int AS aulas
           FROM turnos tu
           LEFT JOIN turmas t ON t.turno_id = tu.id AND ${filtro.condicao}
           LEFT JOIN aulas a ON a.turma_id = t.id AND a.ativo
          WHERE tu.ativo
          GROUP BY tu.id, tu.nome, tu.slug, tu.icone, tu.ordem
          ORDER BY tu.ordem, tu.nome`,
        filtro.parametros
    );

    return resultado.rows;
};

/**
 * Pendencias e conflitos reais existentes no banco, dentro do escopo.
 *
 * Tipos detectados:
 *  - `aula_sem_horario`     aula ativa sem `horario_turno_id`;
 *  - `aula_sem_local`       aula ativa nao-EAD sem local definido;
 *  - `turma_duplicada`      duas aulas ativas da mesma turma no mesmo dia/horario;
 *  - `professor_sobreposto` mesmo professor em aulas com faixas sobrepostas;
 *  - `local_sobreposto`     mesmo local (exceto `virtual`) com faixas sobrepostas;
 *  - `turno_divergente`     horario de turno diferente do turno da turma;
 *  - `campus_divergente`    local de campus diferente do campus da turma.
 *
 * A aula analisada e sempre uma aula do escopo; a aula "do outro lado" do
 * conflito e procurada entre TODAS as aulas ativas, porque um professor pode
 * estar alocado em outro curso/campus e o choque continua sendo real. Apenas a
 * aula do escopo e devolvida, para nao expor dados fora do escopo.
 *
 * Devolve, por tipo, o total completo (`total`) e os primeiros `limitePorTipo`
 * casos, em uma unica consulta (funcoes de janela).
 *
 * @param {object} escopo
 * @param {{limitePorTipo?: number}} [opcoes]
 * @returns {Promise<object[]>} linhas com tipo, total, posicao e dados da aula
 */
const listarPendencias = async (escopo, { limitePorTipo = LIMITE_EXEMPLOS } = {}) => {
    const filtro = filtroTurmasAtivas(escopo, 't');
    const indiceLimite = filtro.proximoIndice;

    const limite = Math.max(inteiroOuNulo(limitePorTipo) || LIMITE_EXEMPLOS, 1);
    const parametros = [...filtro.parametros, limite];

    // Projecao comum a todos os ramos do UNION ALL.
    const colunas = `
        ae.id AS aula_id,
        ae.turma_id,
        ae.turma_nome,
        ae.turma_codigo,
        ae.dia_semana,
        ae.hora_inicio,
        ae.hora_fim,
        ae.disciplina_nome,
        ae.professor_nome,
        ae.local_nome,
        ae.horario_nome
    `;

    const resultado = await db.query(
        `WITH turmas_escopo AS (
                SELECT t.id, t.nome, t.codigo, t.turno_id, t.campus_id
                  FROM turmas t
                 ${filtro.where}
            ),
            aulas_escopo AS (
                SELECT a.id,
                       a.turma_id,
                       a.dia_semana,
                       a.horario_turno_id,
                       a.professor_id,
                       a.local_id,
                       a.modalidade,
                       h.hora_inicio,
                       h.hora_fim,
                       h.nome AS horario_nome,
                       h.turno_id AS horario_turno_id_real,
                       te.nome AS turma_nome,
                       te.codigo AS turma_codigo,
                       te.turno_id AS turma_turno_id,
                       te.campus_id AS turma_campus_id,
                       d.nome AS disciplina_nome,
                       p.nome AS professor_nome,
                       l.nome AS local_nome,
                       l.tipo AS local_tipo,
                       l.campus_id AS local_campus_id,
                       tt.nome AS turma_turno_nome,
                       th.nome AS horario_turno_nome,
                       ct.nome AS turma_campus_nome,
                       cl.nome AS local_campus_nome
                  FROM aulas a
                  JOIN turmas_escopo te ON te.id = a.turma_id
                  JOIN disciplinas d ON d.id = a.disciplina_id
                  LEFT JOIN horarios_turno h ON h.id = a.horario_turno_id
                  LEFT JOIN professores p ON p.id = a.professor_id
                  LEFT JOIN locais l ON l.id = a.local_id
                  LEFT JOIN turnos tt ON tt.id = te.turno_id
                  LEFT JOIN turnos th ON th.id = h.turno_id
                  LEFT JOIN campus ct ON ct.id = te.campus_id
                  LEFT JOIN campus cl ON cl.id = l.campus_id
                 WHERE a.ativo
            ),
            aulas_ativas AS (
                SELECT a.id,
                       a.turma_id,
                       a.dia_semana,
                       a.horario_turno_id,
                       a.professor_id,
                       a.local_id,
                       h.hora_inicio,
                       h.hora_fim
                  FROM aulas a
                  LEFT JOIN horarios_turno h ON h.id = a.horario_turno_id
                 WHERE a.ativo
            ),
            ocorrencias AS (
                SELECT 'aula_sem_horario'::text AS tipo,
                       ${colunas},
                       'Aula ainda sem horário definido'::text AS detalhe
                  FROM aulas_escopo ae
                 WHERE ae.horario_turno_id IS NULL

                UNION ALL

                SELECT 'aula_sem_local'::text,
                       ${colunas},
                       'Aula presencial sem local definido'::text
                  FROM aulas_escopo ae
                 WHERE ae.local_id IS NULL
                   AND ae.modalidade <> 'ead'

                UNION ALL

                SELECT 'turma_duplicada'::text,
                       ${colunas},
                       'A turma tem outra aula no mesmo dia e horário'::text
                  FROM aulas_escopo ae
                 WHERE ae.horario_turno_id IS NOT NULL
                   AND EXISTS (
                       SELECT 1
                         FROM aulas_ativas b
                        WHERE b.turma_id = ae.turma_id
                          AND b.dia_semana = ae.dia_semana
                          AND b.horario_turno_id = ae.horario_turno_id
                          AND b.id <> ae.id
                   )

                UNION ALL

                SELECT 'professor_sobreposto'::text,
                       ${colunas},
                       'O professor ' || COALESCE(ae.professor_nome, 'informado') ||
                       ' tem outra aula no mesmo intervalo'
                  FROM aulas_escopo ae
                 WHERE ae.professor_id IS NOT NULL
                   AND ae.hora_inicio IS NOT NULL
                   AND EXISTS (
                       SELECT 1
                         FROM aulas_ativas b
                        WHERE b.professor_id = ae.professor_id
                          AND b.dia_semana = ae.dia_semana
                          AND b.id <> ae.id
                          AND b.hora_inicio IS NOT NULL
                          AND ae.hora_inicio < b.hora_fim
                          AND b.hora_inicio < ae.hora_fim
                   )

                UNION ALL

                SELECT 'local_sobreposto'::text,
                       ${colunas},
                       'O local ' || COALESCE(ae.local_nome, 'informado') ||
                       ' está ocupado por outra aula no mesmo intervalo'
                  FROM aulas_escopo ae
                 WHERE ae.local_id IS NOT NULL
                   AND ae.local_tipo <> 'virtual'
                   AND ae.hora_inicio IS NOT NULL
                   AND EXISTS (
                       SELECT 1
                         FROM aulas_ativas b
                        WHERE b.local_id = ae.local_id
                          AND b.dia_semana = ae.dia_semana
                          AND b.id <> ae.id
                          AND b.hora_inicio IS NOT NULL
                          AND ae.hora_inicio < b.hora_fim
                          AND b.hora_inicio < ae.hora_fim
                   )

                UNION ALL

                SELECT 'turno_divergente'::text,
                       ${colunas},
                       'Turma do turno ' || COALESCE(ae.turma_turno_nome, 'indefinido') ||
                       ' com horário do turno ' || COALESCE(ae.horario_turno_nome, 'indefinido')
                  FROM aulas_escopo ae
                 WHERE ae.horario_turno_id IS NOT NULL
                   AND ae.horario_turno_id_real IS DISTINCT FROM ae.turma_turno_id

                UNION ALL

                SELECT 'campus_divergente'::text,
                       ${colunas},
                       'Local no campus ' || COALESCE(ae.local_campus_nome, 'indefinido') ||
                       ' e turma no campus ' || COALESCE(ae.turma_campus_nome, 'indefinido')
                  FROM aulas_escopo ae
                 WHERE ae.local_id IS NOT NULL
                   AND ae.local_tipo <> 'virtual'
                   AND ae.local_campus_id IS DISTINCT FROM ae.turma_campus_id
            )
            SELECT *
              FROM (
                  SELECT o.*,
                         COUNT(*) OVER (PARTITION BY o.tipo)::int AS total,
                         ROW_NUMBER() OVER (
                             PARTITION BY o.tipo
                             ORDER BY o.turma_nome, o.dia_semana,
                                      o.hora_inicio NULLS FIRST, o.aula_id
                         )::int AS posicao
                    FROM ocorrencias o
              ) listagem
             WHERE listagem.posicao <= $${indiceLimite}
             ORDER BY listagem.tipo, listagem.posicao`,
        parametros
    );

    return resultado.rows;
};

module.exports = {
    resumoDaGrade,
    contarCadastros,
    distribuicaoPorTurno,
    listarPendencias,
    LIMITE_EXEMPLOS,
};
