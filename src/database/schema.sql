-- ====================================================
-- ESQUEMA FINAL DO BANCO DE DADOS - SISTEMA ACADÊMICO
-- ====================================================

-- Limpa tudo para recriar do zero (Cuidado! Apaga dados existentes)
DROP TABLE IF EXISTS grade CASCADE;
DROP TABLE IF EXISTS turmas CASCADE;
DROP TABLE IF EXISTS turnos CASCADE;
DROP TABLE IF EXISTS cursos CASCADE;
DROP TABLE IF EXISTS disciplinas CASCADE;
DROP TABLE IF EXISTS professores CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

-- 1. TABELAS DE BASE

CREATE TABLE turnos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    slug VARCHAR(50) UNIQUE, -- matutino, noturno, integral, vespertino
    icone VARCHAR(50) DEFAULT 'fa-clock',
    tema_class VARCHAR(50) DEFAULT 'matutino-theme',
    ordem INT DEFAULT 99
);

CREATE TABLE cursos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    semestres_total INT DEFAULT 8,
    coordenador VARCHAR(100) -- Nome exibicional do coordenador
);

CREATE TABLE disciplinas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    carga_horaria INT DEFAULT 60
);

CREATE TABLE professores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100)
);

-- 2. TABELA DE USUÁRIOS (LOGIN E PERMISSÕES)
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    
    -- Tipos: 'admin', 'coordenador', 'nap'
    tipo VARCHAR(20) NOT NULL DEFAULT 'coordenador',
    
    -- Token para login via URL (ex: ?token=michelTI)
    token_acesso VARCHAR(50) UNIQUE,
    
    -- Se for Coordenador, cuida de qual curso?
    curso_responsavel_id INT REFERENCES cursos(id) ON DELETE SET NULL,
    
    -- Se for NAP, cuida de qual unidade? (Águas Claras / Asa Sul)
    unidade_responsavel VARCHAR(50)
);

-- 3. TABELA DE TURMAS (O CENTRO DO SISTEMA)
CREATE TABLE turmas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL, -- Ex: "Turma A"
    semestre_ref VARCHAR(50),   -- Ex: "1º Semestre"
    unidade VARCHAR(50) DEFAULT 'Águas Claras', -- Águas Claras ou Asa Sul
    
    curso_id INT REFERENCES cursos(id) ON DELETE CASCADE,
    turno_id INT REFERENCES turnos(id) ON DELETE SET NULL
);

-- 4. TABELA GRADE (AULAS)
CREATE TABLE grade (
    id SERIAL PRIMARY KEY,
    turma_id INT REFERENCES turmas(id) ON DELETE CASCADE,
    disciplina_id INT REFERENCES disciplinas(id) ON DELETE CASCADE,
    professor_id INT REFERENCES professores(id) ON DELETE SET NULL,
    
    dia_semana VARCHAR(3) NOT NULL, -- SEG, TER, QUA, QUI, SEX
    sala VARCHAR(20),               -- Ex: Lab 03 (NAP edita isso)
    
    icone_dia VARCHAR(50) DEFAULT 'fa-calendar',
    e_livre BOOLEAN DEFAULT FALSE
);

-- ==========================================
-- DADOS INICIAIS (SEEDS)
-- ==========================================

-- 1. TURNOS
INSERT INTO turnos (nome, slug, icone, tema_class, ordem) VALUES 
('Integral', 'integral', 'fa-clock', 'integral-theme', 1),
('Matutino', 'matutino', 'fa-sun', 'matutino-theme', 2),
('Vespertino', 'vespertino', 'fa-cloud-sun', 'vespertino-theme', 3),
('Noturno', 'noturno', 'fa-moon', 'noturno-theme', 4);

-- 2. CURSOS DE EXEMPLO
INSERT INTO cursos (nome, coordenador, semestres_total) VALUES 
('Ciência da Computação', 'Prof. Michel Junio', 8),
('Direito', 'Profa. Ana Silva', 10),
('Enfermagem', 'Prof. João Médico', 8);

-- 3. USUÁRIOS
-- Para segurança, usuários e senhas não são mais inseridos automaticamente no schema.
-- Cadastre os usuários manualmente no banco após a configuração do ambiente.

-- 4. ALGUNS PROFESSORES E DISCIPLINAS
INSERT INTO professores (nome) VALUES ('Prof. Edward Lima'), ('Profa. Maria Jurista'), ('Prof. Alan Turing');
INSERT INTO disciplinas (nome) VALUES ('Algoritmos'), ('Direito Constitucional'), ('Anatomia');
