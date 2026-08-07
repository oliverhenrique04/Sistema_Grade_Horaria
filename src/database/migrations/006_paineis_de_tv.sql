-- ============================================================================
-- 006 - Paineis de TV (as telas dos blocos).
--
-- PROBLEMA QUE ESTA MIGRATION RESOLVE
--
-- Ate aqui cada TV era configurada por uma URL montada a mao, com o recorte
-- inteiro na query string. Isso funciona, mas cobra caro depois:
--
--   - nao se sabe quantas telas existem nem onde estao;
--   - corrigir uma exige ir ate ela, ou achar quem tem o link;
--   - o titulo exibido em corpo grande sob a marca da instituicao viaja num
--     parametro que qualquer um pode reescrever antes de mandar o link adiante;
--   - o recorte por sala congela: um bloco que ganha uma sala nova continua
--     mostrando as antigas, porque a URL guarda ids de local, nao o bloco.
--
-- SOLUCAO
--
-- Cada painel vira registro. A TV aponta para `/painel/<slug>` e o recorte mora
-- aqui, editavel pelo painel administrativo sem tocar no aparelho.
--
-- A URL antiga (`/painel?campus=1&locais=...`) continua valendo: ha TV em
-- producao configurada assim, e quebrar isso seria trocar um problema por
-- outro.
--
-- POR QUE `blocos` E TEXT[] DE LETRAS, E NAO UMA TABELA
--
-- A instituicao ja codifica o predio na ultima letra do nome da sala ("101 C").
-- Guardar a LETRA, e nao a lista de salas, faz o painel acompanhar sozinho as
-- salas que forem cadastradas depois — que e justamente o que a URL nao fazia.
-- Uma tabela `blocos` exigiria manter o cadastro em dia para ganhar a mesma
-- coisa.
--
-- POR QUE ARRAYS, E NAO TABELAS DE LIGACAO
--
-- Sao listas curtas, lidas inteiras, sempre no contexto do painel, e nunca
-- consultadas ao contrario ("em que paineis este curso aparece?"). Uma tabela
-- de ligacao por eixo custaria cinco joins para montar uma tela que cabe numa
-- linha. Os ids sao validados no servico contra o cadastro vivo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS paineis (
    id SERIAL PRIMARY KEY,

    -- Aparece na URL da TV: /painel/bloco-c
    slug VARCHAR(60) NOT NULL,
    -- Aparece em corpo grande na tela.
    titulo VARCHAR(60) NOT NULL,

    campus_id INT NOT NULL REFERENCES campus (id) ON DELETE RESTRICT,

    -- Eixos do recorte. Vazio significa "todos" em cada um deles, e nao
    -- "nenhum": um painel recem-criado mostra o campus inteiro.
    blocos TEXT[] NOT NULL DEFAULT '{}',
    locais_ids INT[] NOT NULL DEFAULT '{}',
    cursos_ids INT[] NOT NULL DEFAULT '{}',
    turmas_ids INT[] NOT NULL DEFAULT '{}',
    turnos_ids INT[] NOT NULL DEFAULT '{}',
    -- Dias da semana que este painel cobre (1..6). Vazio = todos.
    dias INT[] NOT NULL DEFAULT '{}',

    -- Aula ainda sem sala continua no quadro, marcada como "a definir". O
    -- padrao e TRUE porque o cubo do TOTVS nao exporta sala: sem isso a TV de
    -- um bloco nasce vazia e so enche quando o ensalamento terminar.
    incluir_sem_local BOOLEAN NOT NULL DEFAULT TRUE,

    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_painel_slug UNIQUE (slug),
    CONSTRAINT ck_painel_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT ck_painel_titulo CHECK (length(btrim(titulo)) > 0),
    -- Espelha o CHECK de `aulas.dia_semana`: segunda a sabado.
    CONSTRAINT ck_painel_dias CHECK (dias <@ ARRAY[1, 2, 3, 4, 5, 6])
);

CREATE INDEX IF NOT EXISTS ix_paineis_campus ON paineis (campus_id, ativo);

DROP TRIGGER IF EXISTS tg_paineis_atualizado ON paineis;
CREATE TRIGGER tg_paineis_atualizado
    BEFORE UPDATE ON paineis
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
