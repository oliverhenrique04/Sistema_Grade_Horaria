-- ============================================================================
-- 001 - Arquivamento do modelo legado.
--
-- O modelo antigo (cursos, disciplinas, professores, turmas, turnos, usuarios,
-- grade) e movido para o schema "legado". NENHUM dado e apagado: as tabelas
-- continuam consultaveis (ex.: SELECT * FROM legado.grade) e podem ser
-- restauradas movendo-as de volta.
--
-- Mover de schema (em vez de renomear) carrega junto indices, constraints e
-- sequences, evitando colisao de nomes com as tabelas novas criadas na 002.
--
-- Em um banco/schema vazio (ambiente de teste) esta migration nao faz nada.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS legado;

DO $$
DECLARE
    tabela TEXT;
    tabelas TEXT[] := ARRAY['grade', 'turmas', 'usuarios', 'cursos', 'disciplinas', 'professores', 'turnos'];
    schema_atual TEXT := current_schema();
BEGIN
    FOREACH tabela IN ARRAY tabelas LOOP
        -- Move apenas se a tabela existe no schema corrente e ainda nao foi arquivada.
        IF to_regclass(format('%I.%I', schema_atual, tabela)) IS NOT NULL
           AND to_regclass(format('legado.%I', tabela)) IS NULL THEN
            EXECUTE format('ALTER TABLE %I.%I SET SCHEMA legado', schema_atual, tabela);
            RAISE NOTICE 'Tabela % arquivada em legado.%', tabela, tabela;
        END IF;
    END LOOP;
END $$;

-- Registro permanente do que foi arquivado, para consulta posterior.
CREATE TABLE IF NOT EXISTS legado.arquivamento (
    id SERIAL PRIMARY KEY,
    tabela TEXT NOT NULL,
    linhas BIGINT,
    arquivado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
    nome_tabela TEXT;
    total BIGINT;
BEGIN
    FOR nome_tabela IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'legado'
           AND c.relkind = 'r'
           AND c.relname <> 'arquivamento'
    LOOP
        IF NOT EXISTS (SELECT 1 FROM legado.arquivamento a WHERE a.tabela = nome_tabela) THEN
            EXECUTE format('SELECT COUNT(*) FROM legado.%I', nome_tabela) INTO total;
            INSERT INTO legado.arquivamento (tabela, linhas) VALUES (nome_tabela, total);
        END IF;
    END LOOP;
END $$;
