-- ============================================================================
-- 002 - Modelo academico normalizado.
--
-- Cria a estrutura definitiva do sistema. Idempotente (IF NOT EXISTS) e sem
-- nenhum DROP destrutivo: o modelo antigo permanece intacto no schema "legado".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Funcao utilitaria de auditoria (atualizado_em)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_atualizado_em() RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Campus
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campus (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    sigla VARCHAR(20),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_campus_nome UNIQUE (nome)
);

DROP TRIGGER IF EXISTS tg_campus_atualizado ON campus;
CREATE TRIGGER tg_campus_atualizado
    BEFORE UPDATE ON campus
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Turnos (quantidade de horarios e livre, definida em horarios_turno)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(60) NOT NULL,
    slug VARCHAR(60) NOT NULL,
    icone VARCHAR(50) NOT NULL DEFAULT 'fa-clock',
    tema_class VARCHAR(50),
    ordem INT NOT NULL DEFAULT 99,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_turno_nome UNIQUE (nome),
    CONSTRAINT uq_turno_slug UNIQUE (slug)
);

DROP TRIGGER IF EXISTS tg_turnos_atualizado ON turnos;
CREATE TRIGGER tg_turnos_atualizado
    BEFORE UPDATE ON turnos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Horarios do turno: cada periodo tem exatamente 50 minutos e nao pode se
-- sobrepor a outro periodo ativo do mesmo turno. Intervalos entre periodos sao
-- permitidos (basta deixar lacuna entre hora_fim e o hora_inicio seguinte).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horarios_turno (
    id SERIAL PRIMARY KEY,
    turno_id INT NOT NULL REFERENCES turnos (id) ON DELETE RESTRICT,
    nome VARCHAR(60) NOT NULL,
    ordem INT NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_horario_duracao_50min CHECK (hora_fim - hora_inicio = INTERVAL '50 minutes'),
    CONSTRAINT uq_horario_turno_ordem UNIQUE (turno_id, ordem)
);

CREATE INDEX IF NOT EXISTS ix_horarios_turno_turno ON horarios_turno (turno_id, ordem);

CREATE OR REPLACE FUNCTION fn_valida_sobreposicao_horario() RETURNS TRIGGER AS $$
DECLARE
    conflitante RECORD;
BEGIN
    IF NOT NEW.ativo THEN
        RETURN NEW;
    END IF;

    SELECT h.nome, h.hora_inicio, h.hora_fim
      INTO conflitante
      FROM horarios_turno h
     WHERE h.turno_id = NEW.turno_id
       AND h.id IS DISTINCT FROM NEW.id
       AND h.ativo
       AND h.hora_inicio < NEW.hora_fim
       AND NEW.hora_inicio < h.hora_fim
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'O horário % (% às %) se sobrepõe ao horário % (% às %) do mesmo turno.',
            NEW.nome,
            TO_CHAR(NEW.hora_inicio, 'HH24:MI'),
            TO_CHAR(NEW.hora_fim, 'HH24:MI'),
            conflitante.nome,
            TO_CHAR(conflitante.hora_inicio, 'HH24:MI'),
            TO_CHAR(conflitante.hora_fim, 'HH24:MI')
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_valida_sobreposicao_horario ON horarios_turno;
CREATE TRIGGER tg_valida_sobreposicao_horario
    BEFORE INSERT OR UPDATE ON horarios_turno
    FOR EACH ROW EXECUTE FUNCTION fn_valida_sobreposicao_horario();

DROP TRIGGER IF EXISTS tg_horarios_turno_atualizado ON horarios_turno;
CREATE TRIGGER tg_horarios_turno_atualizado
    BEFORE UPDATE ON horarios_turno
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Periodos letivos (substitui o "2026.1" fixo nas views)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS periodos_letivos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL,
    ano INT NOT NULL,
    semestre INT NOT NULL,
    data_inicio DATE,
    data_fim DATE,
    atual BOOLEAN NOT NULL DEFAULT FALSE,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_periodo_codigo UNIQUE (codigo),
    CONSTRAINT ck_periodo_ano CHECK (ano BETWEEN 2000 AND 2100),
    CONSTRAINT ck_periodo_semestre CHECK (semestre BETWEEN 1 AND 4),
    CONSTRAINT ck_periodo_datas CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);

-- No maximo um periodo letivo marcado como atual.
CREATE UNIQUE INDEX IF NOT EXISTS ux_periodo_letivo_atual ON periodos_letivos (atual) WHERE atual;

DROP TRIGGER IF EXISTS tg_periodos_atualizado ON periodos_letivos;
CREATE TRIGGER tg_periodos_atualizado
    BEFORE UPDATE ON periodos_letivos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Cursos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cursos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    sigla VARCHAR(20),
    coordenador VARCHAR(120),
    semestres_total INT NOT NULL DEFAULT 8,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_curso_nome UNIQUE (nome),
    CONSTRAINT ck_curso_semestres CHECK (semestres_total BETWEEN 1 AND 20)
);

DROP TRIGGER IF EXISTS tg_cursos_atualizado ON cursos;
CREATE TRIGGER tg_cursos_atualizado
    BEFORE UPDATE ON cursos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE TABLE IF NOT EXISTS curso_campus (
    curso_id INT NOT NULL REFERENCES cursos (id) ON DELETE CASCADE,
    campus_id INT NOT NULL REFERENCES campus (id) ON DELETE CASCADE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (curso_id, campus_id)
);

-- ---------------------------------------------------------------------------
-- Disciplinas, matriz curricular e professores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disciplinas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    codigo VARCHAR(30),
    carga_horaria INT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_disciplina_carga CHECK (carga_horaria IS NULL OR carga_horaria > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_disciplina_codigo ON disciplinas (LOWER(codigo)) WHERE codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_disciplinas_nome ON disciplinas (LOWER(nome));

DROP TRIGGER IF EXISTS tg_disciplinas_atualizado ON disciplinas;
CREATE TRIGGER tg_disciplinas_atualizado
    BEFORE UPDATE ON disciplinas
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE TABLE IF NOT EXISTS curso_disciplinas (
    id SERIAL PRIMARY KEY,
    curso_id INT NOT NULL REFERENCES cursos (id) ON DELETE CASCADE,
    disciplina_id INT NOT NULL REFERENCES disciplinas (id) ON DELETE CASCADE,
    semestre_sugerido INT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_curso_disciplina UNIQUE (curso_id, disciplina_id),
    CONSTRAINT ck_curso_disciplina_semestre CHECK (semestre_sugerido IS NULL OR semestre_sugerido BETWEEN 1 AND 20)
);

CREATE TABLE IF NOT EXISTS professores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_professor_email ON professores (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_professores_nome ON professores (LOWER(nome));

DROP TRIGGER IF EXISTS tg_professores_atualizado ON professores;
CREATE TRIGGER tg_professores_atualizado
    BEFORE UPDATE ON professores
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Locais (substituem o campo textual "sala")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locais (
    id SERIAL PRIMARY KEY,
    campus_id INT NOT NULL REFERENCES campus (id) ON DELETE RESTRICT,
    nome VARCHAR(120) NOT NULL,
    codigo VARCHAR(40),
    tipo VARCHAR(20) NOT NULL DEFAULT 'sala',
    capacidade INT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_local_campus_nome UNIQUE (campus_id, nome),
    CONSTRAINT ck_local_tipo CHECK (tipo IN ('sala', 'laboratorio', 'auditorio', 'skill_lab', 'virtual', 'outro')),
    CONSTRAINT ck_local_capacidade CHECK (capacidade IS NULL OR capacidade >= 0)
);

CREATE INDEX IF NOT EXISTS ix_locais_campus ON locais (campus_id, ativo);

DROP TRIGGER IF EXISTS tg_locais_atualizado ON locais;
CREATE TRIGGER tg_locais_atualizado
    BEFORE UPDATE ON locais
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Turmas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turmas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    codigo VARCHAR(40),
    periodo_letivo_id INT NOT NULL REFERENCES periodos_letivos (id) ON DELETE RESTRICT,
    campus_id INT NOT NULL REFERENCES campus (id) ON DELETE RESTRICT,
    curso_id INT NOT NULL REFERENCES cursos (id) ON DELETE RESTRICT,
    semestre_curricular INT NOT NULL,
    turno_id INT NOT NULL REFERENCES turnos (id) ON DELETE RESTRICT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_turma_semestre CHECK (semestre_curricular BETWEEN 1 AND 20)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_turma_codigo_periodo
    ON turmas (periodo_letivo_id, LOWER(codigo)) WHERE codigo IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_turmas_curso ON turmas (curso_id, ativo);
CREATE INDEX IF NOT EXISTS ix_turmas_campus ON turmas (campus_id, ativo);
CREATE INDEX IF NOT EXISTS ix_turmas_periodo ON turmas (periodo_letivo_id);
CREATE INDEX IF NOT EXISTS ix_turmas_turno ON turmas (turno_id);

DROP TRIGGER IF EXISTS tg_turmas_atualizado ON turmas;
CREATE TRIGGER tg_turmas_atualizado
    BEFORE UPDATE ON turmas
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Usuarios: autenticacao por e-mail/senha e escopo multiplo (varios cursos e
-- varios campus por usuario). Nao existe mais token de acesso por URL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    perfil VARCHAR(20) NOT NULL DEFAULT 'coordenador',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_login_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_usuario_perfil CHECK (perfil IN ('admin', 'coordenador', 'nap'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_email ON usuarios (LOWER(email));

DROP TRIGGER IF EXISTS tg_usuarios_atualizado ON usuarios;
CREATE TRIGGER tg_usuarios_atualizado
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE TABLE IF NOT EXISTS usuario_cursos (
    usuario_id INT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    curso_id INT NOT NULL REFERENCES cursos (id) ON DELETE CASCADE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usuario_id, curso_id)
);

CREATE TABLE IF NOT EXISTS usuario_campus (
    usuario_id INT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    campus_id INT NOT NULL REFERENCES campus (id) ON DELETE CASCADE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usuario_id, campus_id)
);

-- ---------------------------------------------------------------------------
-- Aulas (grade horaria). dia_semana: 1 = segunda ... 6 = sabado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aulas (
    id SERIAL PRIMARY KEY,
    turma_id INT NOT NULL REFERENCES turmas (id) ON DELETE CASCADE,
    disciplina_id INT NOT NULL REFERENCES disciplinas (id) ON DELETE RESTRICT,
    professor_id INT REFERENCES professores (id) ON DELETE SET NULL,
    local_id INT REFERENCES locais (id) ON DELETE SET NULL,
    dia_semana INT NOT NULL,
    horario_turno_id INT REFERENCES horarios_turno (id) ON DELETE RESTRICT,
    modalidade VARCHAR(20) NOT NULL DEFAULT 'presencial',
    observacao VARCHAR(255),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_aula_dia_semana CHECK (dia_semana BETWEEN 1 AND 6),
    CONSTRAINT ck_aula_modalidade CHECK (modalidade IN ('presencial', 'ead', 'hibrido'))
);

CREATE INDEX IF NOT EXISTS ix_aulas_turma ON aulas (turma_id, dia_semana);
CREATE INDEX IF NOT EXISTS ix_aulas_professor ON aulas (professor_id, dia_semana) WHERE professor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_aulas_local ON aulas (local_id, dia_semana) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_aulas_horario ON aulas (horario_turno_id);
CREATE INDEX IF NOT EXISTS ix_aulas_sem_horario ON aulas (turma_id) WHERE horario_turno_id IS NULL;

-- Rede de seguranca no banco: uma turma nao pode ter duas aulas ativas no mesmo
-- dia e horario. Conflitos de professor e local dependem da faixa de horario
-- real (turnos diferentes podem coincidir no relogio) e sao validados no
-- servico de conflitos, dentro de transacao.
CREATE UNIQUE INDEX IF NOT EXISTS ux_aula_turma_slot
    ON aulas (turma_id, dia_semana, horario_turno_id)
    WHERE ativo AND horario_turno_id IS NOT NULL;

DROP TRIGGER IF EXISTS tg_aulas_atualizado ON aulas;
CREATE TRIGGER tg_aulas_atualizado
    BEFORE UPDATE ON aulas
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------------
-- Sessoes (connect-pg-simple)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session" (
    sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" (expire);
