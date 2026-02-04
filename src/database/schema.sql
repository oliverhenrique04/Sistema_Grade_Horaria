-- Limpa tabelas antigas se existirem (para evitar erros de conflito)
DROP TABLE IF EXISTS grade CASCADE;
DROP TABLE IF EXISTS turmas CASCADE;
DROP TABLE IF EXISTS turnos CASCADE;
DROP TABLE IF EXISTS cursos CASCADE;
DROP TABLE IF EXISTS disciplinas CASCADE;
DROP TABLE IF EXISTS professores CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

-- 1. Tabela de Usuários (Login do Admin)
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL, -- Em produção, usar hash!
    tipo VARCHAR(20) DEFAULT 'admin'
);

-- 2. Tabela de Turnos (Agora com Ordem, Ícone e Slug)
CREATE TABLE turnos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL, -- matutino, noturno, etc.
    icone VARCHAR(50) DEFAULT 'fa-clock', -- Ícone do FontAwesome
    tema_class VARCHAR(50) DEFAULT 'matutino-theme', -- Classe CSS para cores
    ordem INT DEFAULT 99 -- Para ordenar: Integral(1) -> Noturno(4)
);

-- 3. Tabela de Cursos (Com Coordenador)
CREATE TABLE cursos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    semestres_total INT DEFAULT 8,
    coordenador VARCHAR(100) -- Nome do coordenador do curso
);

-- 4. Tabela de Professores
CREATE TABLE professores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100)
);

-- 5. Tabela de Disciplinas
CREATE TABLE disciplinas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    carga_horaria INT DEFAULT 60
);

-- 6. Tabela de Turmas (Vincula Curso + Turno + Semestre)
CREATE TABLE turmas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL, -- Ex: "Turma A - 1º Semestre"
    semestre_ref VARCHAR(50),   -- Ex: "1º" ou "1º e 2º"
    curso_id INT REFERENCES cursos(id) ON DELETE CASCADE,
    turno_id INT REFERENCES turnos(id) ON DELETE SET NULL
);

-- 7. Tabela Grade (Onde acontece o relacionamento final)
CREATE TABLE grade (
    id SERIAL PRIMARY KEY,
    turma_id INT REFERENCES turmas(id) ON DELETE CASCADE,
    disciplina_id INT REFERENCES disciplinas(id) ON DELETE CASCADE,
    professor_id INT REFERENCES professores(id) ON DELETE SET NULL,
    dia_semana VARCHAR(3) NOT NULL, -- SEG, TER, QUA, QUI, SEX
    icone_dia VARCHAR(50) DEFAULT 'fa-calendar',
    e_livre BOOLEAN DEFAULT FALSE -- Se for true, é "Sem Aula"
);

-- ==========================================
-- DADOS INICIAIS (SEEDS)
-- ==========================================

-- Criar Admin Padrão
INSERT INTO usuarios (nome, email, senha) VALUES 
('Administrador', 'admin@escola.com', 'admin123');

-- Criar Turnos Padrão (Na ordem correta e com ícones)
INSERT INTO turnos (nome, slug, icone, tema_class, ordem) VALUES 
('Integral', 'integral', 'fa-clock', 'integral-theme', 1),
('Matutino', 'matutino', 'fa-sun', 'matutino-theme', 2),
('Vespertino', 'vespertino', 'fa-cloud-sun', 'vespertino-theme', 3),
('Noturno', 'noturno', 'fa-moon', 'noturno-theme', 4);

-- Criar alguns cursos de exemplo
INSERT INTO cursos (nome, coordenador, semestres_total) VALUES 
('Ciência da Computação', 'Prof. Michel Junio', 8),
('Direito', 'Profa. Ana Silva', 10);