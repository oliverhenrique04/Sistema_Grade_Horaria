-- ============================================================================
-- 003 - Remove credenciais inutilizaveis do arquivo legado.
--
-- A tabela legado.usuarios preserva os cadastros do modelo antigo, mas guardava
-- senhas em TEXTO PURO e tokens de acesso por URL. Nada disso e utilizavel no
-- modelo novo (autenticacao por e-mail/senha com bcrypt) e manter esses valores
-- e um risco desnecessario. Os demais campos do arquivo permanecem intactos.
--
-- Idempotente e segura em bancos sem o schema legado (ambiente de teste).
-- ============================================================================

DO $$
BEGIN
    IF to_regclass('legado.usuarios') IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'legado'
           AND table_name = 'usuarios'
           AND column_name = 'senha'
    ) THEN
        EXECUTE 'ALTER TABLE legado.usuarios DROP COLUMN senha';
        RAISE NOTICE 'Coluna legado.usuarios.senha (texto puro) removida.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'legado'
           AND table_name = 'usuarios'
           AND column_name = 'token_acesso'
    ) THEN
        EXECUTE 'ALTER TABLE legado.usuarios DROP COLUMN token_acesso';
        RAISE NOTICE 'Coluna legado.usuarios.token_acesso removida.';
    END IF;
END $$;
