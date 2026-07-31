-- ============================================================================
-- 004 - Integracao com o cubo do TOTVS Educacional.
--
-- Acrescenta o que falta para carregar a grade a partir da exportacao do cubo
-- SEM duplicar registro a cada carga e SEM perder informacao que o modelo atual
-- nao comporta. Migration aditiva: nenhum DROP de tabela ou de coluna.
--
-- Decisoes registradas aqui porque mudam invariantes do modelo:
--
-- 1. CODTURMA se repete entre filiais (existe "DIR01M1" em Asa Sul e outra em
--    Aguas Claras, com ofertas diferentes). A unicidade do codigo da turma passa
--    a ser por periodo letivo + campus.
--
-- 2. Turma gerencial. No TOTVS uma turma "gerencial" (GPDIRM, GPFISM, ...)
--    concentra as disciplinas compartilhadas por varias turmas regulares. Ela
--    nao tem semestre curricular (agrupa do 1o ao 10o) e oferta disciplinas
--    simultaneas: as 4 optativas das 08:50 de segunda sao aulas paralelas para
--    turmas diferentes, nao um choque de agenda. Por isso:
--      - `semestre_curricular` passa a aceitar NULL (somente faz sentido em
--        turma regular);
--      - `ux_aula_turma_slot` passa a considerar a disciplina, permitindo
--        aulas paralelas. O choque real continua barrado no `conflitoService`,
--        que so libera o paralelismo quando a turma e gerencial.
--
-- 3. Co-docencia. A mesma aula pode ter varios professores (uma clinica de
--    Odontologia chega a dez). `aulas.professor_id` continua sendo o professor
--    principal — nada no sistema atual muda — e `aula_professores` guarda a
--    equipe completa.
--
-- 4. Idempotencia. `aulas.origem_chave` guarda a identidade da aula na origem
--    (IDTURMADISC + dia + hora). Reimportar a mesma planilha atualiza as aulas
--    existentes em vez de duplicar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Codigos externos: chave estavel de deduplicacao em cada carga
-- ---------------------------------------------------------------------------
ALTER TABLE campus ADD COLUMN IF NOT EXISTS codigo_externo VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS ux_campus_codigo_externo
    ON campus (UPPER(codigo_externo)) WHERE codigo_externo IS NOT NULL;

ALTER TABLE cursos ADD COLUMN IF NOT EXISTS codigo VARCHAR(30);

CREATE UNIQUE INDEX IF NOT EXISTS ux_curso_codigo
    ON cursos (UPPER(codigo)) WHERE codigo IS NOT NULL;

-- Chapa do professor no RM.
ALTER TABLE professores ADD COLUMN IF NOT EXISTS matricula VARCHAR(30);

CREATE UNIQUE INDEX IF NOT EXISTS ux_professor_matricula
    ON professores (UPPER(matricula)) WHERE matricula IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Turmas: gerencial, vinculo com as turmas que ela atende e semestre opcional
-- ---------------------------------------------------------------------------
ALTER TABLE turmas ADD COLUMN IF NOT EXISTS gerencial BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE turmas
    ADD COLUMN IF NOT EXISTS turma_gerencial_id INT REFERENCES turmas (id) ON DELETE SET NULL;

ALTER TABLE turmas ALTER COLUMN semestre_curricular DROP NOT NULL;

ALTER TABLE turmas DROP CONSTRAINT IF EXISTS ck_turma_semestre;
ALTER TABLE turmas ADD CONSTRAINT ck_turma_semestre
    CHECK (semestre_curricular IS NULL OR semestre_curricular BETWEEN 1 AND 20);

-- Nao existe regra "toda turma regular tem semestre": alem das gerenciais, a
-- instituicao oferta turmas especiais (DIRESPM1) que atravessam semestres. O
-- semestre e opcional no banco e continua obrigatorio no formulario manual.
ALTER TABLE turmas DROP CONSTRAINT IF EXISTS ck_turma_semestre_gerencial;

-- Uma turma nunca aponta para si mesma como gerencial.
ALTER TABLE turmas DROP CONSTRAINT IF EXISTS ck_turma_gerencial_propria;
ALTER TABLE turmas ADD CONSTRAINT ck_turma_gerencial_propria
    CHECK (turma_gerencial_id IS NULL OR turma_gerencial_id <> id);

-- O codigo da turma e unico por periodo letivo E campus (ver decisao 1).
DROP INDEX IF EXISTS ux_turma_codigo_periodo;
CREATE UNIQUE INDEX IF NOT EXISTS ux_turma_codigo_periodo_campus
    ON turmas (periodo_letivo_id, campus_id, LOWER(codigo)) WHERE codigo IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_turmas_gerencial
    ON turmas (turma_gerencial_id) WHERE turma_gerencial_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Aulas: origem rastreavel e paralelismo nas turmas gerenciais
-- ---------------------------------------------------------------------------
ALTER TABLE aulas ADD COLUMN IF NOT EXISTS origem VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE aulas ADD COLUMN IF NOT EXISTS origem_chave VARCHAR(160);

ALTER TABLE aulas DROP CONSTRAINT IF EXISTS ck_aula_origem;
ALTER TABLE aulas ADD CONSTRAINT ck_aula_origem CHECK (origem IN ('manual', 'totvs'));

-- Identidade da aula no sistema de origem: reimportar atualiza, nunca duplica.
CREATE UNIQUE INDEX IF NOT EXISTS ux_aula_origem_chave
    ON aulas (origem, origem_chave) WHERE origem_chave IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_aulas_origem ON aulas (origem) WHERE origem <> 'manual';

-- Rede de seguranca do banco (ver decisao 2): a mesma turma nao pode ter duas
-- aulas ativas da MESMA disciplina no mesmo dia e horario. Disciplinas
-- diferentes em paralelo sao validas para turma gerencial e continuam barradas
-- pelo `conflitoService` nas demais.
DROP INDEX IF EXISTS ux_aula_turma_slot;
CREATE UNIQUE INDEX IF NOT EXISTS ux_aula_turma_slot
    ON aulas (turma_id, dia_semana, horario_turno_id, disciplina_id)
    WHERE ativo AND horario_turno_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Equipe da aula (co-docencia)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aula_professores (
    aula_id INT NOT NULL REFERENCES aulas (id) ON DELETE CASCADE,
    professor_id INT NOT NULL REFERENCES professores (id) ON DELETE CASCADE,
    papel VARCHAR(20) NOT NULL DEFAULT 'titular',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (aula_id, professor_id),
    CONSTRAINT ck_aula_professor_papel
        CHECK (papel IN ('titular', 'coordenador', 'substituto', 'outro'))
);

CREATE INDEX IF NOT EXISTS ix_aula_professores_professor ON aula_professores (professor_id);

-- ---------------------------------------------------------------------------
-- Historico das cargas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS importacoes (
    id SERIAL PRIMARY KEY,
    origem VARCHAR(20) NOT NULL DEFAULT 'totvs',
    arquivo VARCHAR(255),
    periodo_letivo_id INT REFERENCES periodos_letivos (id) ON DELETE SET NULL,
    usuario_id INT REFERENCES usuarios (id) ON DELETE SET NULL,
    linhas_lidas INT NOT NULL DEFAULT 0,
    linhas_consideradas INT NOT NULL DEFAULT 0,
    resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
    avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_importacao_origem CHECK (origem IN ('totvs'))
);

CREATE INDEX IF NOT EXISTS ix_importacoes_criado ON importacoes (criado_em DESC);
