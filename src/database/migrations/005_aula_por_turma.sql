-- ============================================================================
-- 005 - Quais turmas assistem cada aula.
--
-- PROBLEMA QUE ESTA MIGRATION RESOLVE
--
-- A turma gerencial (GPDIRM) concentra as disciplinas compartilhadas, e cada
-- uma delas atende um conjunto proprio de turmas regulares — quase sempre de
-- semestres diferentes: "Direito Internacional" e do 7o E do 8o; "Direitos
-- Humanos", do 1o E do 2o. Na exportacao do cubo, 237 das 287 disciplinas
-- compartilhadas atendem mais de um semestre ao mesmo tempo.
--
-- Isso torna impossivel dar UM semestre a turma gerencial ou a aula. E, com a
-- aula registrada so na gerencial, a grade de DIR08M1 ficava vazia: o aluno do
-- 8o semestre nao encontrava as proprias disciplinas.
--
-- SOLUCAO
--
-- `aula_turmas` guarda quais turmas assistem cada aula. A aula continua com um
-- unico registro (nada e duplicado), mas passa a ser enxergada pela grade de
-- todas as turmas que a cursam, cada uma com o seu proprio semestre.
--
-- A view `vw_aulas_das_turmas` resolve os dois casos de uma vez: a turma dona da
-- aula sempre a enxerga (`propria = TRUE`) e as turmas atendidas tambem
-- (`propria = FALSE`). Aula comum, sem compartilhamento, nao muda em nada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS aula_turmas (
    aula_id INT NOT NULL REFERENCES aulas (id) ON DELETE CASCADE,
    turma_id INT NOT NULL REFERENCES turmas (id) ON DELETE CASCADE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (aula_id, turma_id)
);

CREATE INDEX IF NOT EXISTS ix_aula_turmas_turma ON aula_turmas (turma_id);

-- Todas as duplas (aula, turma que a assiste).
--
-- `propria` distingue a turma em que a aula esta registrada das turmas que
-- apenas a cursam: no painel, uma aula herdada e exibida mas nao pode ser
-- editada pela turma que a recebe — a alteracao pertence a turma que a oferta.
CREATE OR REPLACE VIEW vw_aulas_das_turmas AS
SELECT a.id AS aula_id,
       a.turma_id,
       TRUE AS propria
  FROM aulas a
 UNION ALL
SELECT at.aula_id,
       at.turma_id,
       FALSE AS propria
  FROM aula_turmas at
 WHERE NOT EXISTS (
     SELECT 1 FROM aulas a WHERE a.id = at.aula_id AND a.turma_id = at.turma_id
 );
