--
-- PostgreSQL database dump
--

\restrict EQfPGbPkyYyih9PAHXsAzVcDPaNqTvqbZdiyIOMhLvPh4f2yhdajNHebjn3vhJM

-- Dumped from database version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cursos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cursos (
    id integer NOT NULL,
    nome character varying(100),
    semestres_total integer,
    coordenador character varying(100)
);


ALTER TABLE public.cursos OWNER TO postgres;

--
-- Name: cursos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cursos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cursos_id_seq OWNER TO postgres;

--
-- Name: cursos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cursos_id_seq OWNED BY public.cursos.id;


--
-- Name: disciplinas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.disciplinas (
    id integer NOT NULL,
    nome character varying(100),
    carga_horaria integer
);


ALTER TABLE public.disciplinas OWNER TO postgres;

--
-- Name: disciplinas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.disciplinas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.disciplinas_id_seq OWNER TO postgres;

--
-- Name: disciplinas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.disciplinas_id_seq OWNED BY public.disciplinas.id;


--
-- Name: grade; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grade (
    id integer NOT NULL,
    turma_id integer,
    dia_semana character varying(3),
    disciplina_id integer,
    professor_id integer,
    icone_dia character varying(50) DEFAULT 'fa-calendar'::character varying,
    nota_compartilhada character varying(50),
    e_livre boolean DEFAULT false,
    e_split boolean DEFAULT false,
    sala character varying(20)
);


ALTER TABLE public.grade OWNER TO postgres;

--
-- Name: grade_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grade_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grade_id_seq OWNER TO postgres;

--
-- Name: grade_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grade_id_seq OWNED BY public.grade.id;


--
-- Name: professores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.professores (
    id integer NOT NULL,
    nome character varying(100),
    email character varying(100)
);


ALTER TABLE public.professores OWNER TO postgres;

--
-- Name: professores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.professores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.professores_id_seq OWNER TO postgres;

--
-- Name: professores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.professores_id_seq OWNED BY public.professores.id;


--
-- Name: turmas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.turmas (
    id integer NOT NULL,
    nome character varying(100),
    semestre_ref character varying(50),
    curso_id integer,
    turno_id integer,
    unidade character varying(50)
);


ALTER TABLE public.turmas OWNER TO postgres;

--
-- Name: turmas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.turmas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.turmas_id_seq OWNER TO postgres;

--
-- Name: turmas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.turmas_id_seq OWNED BY public.turmas.id;


--
-- Name: turnos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.turnos (
    id integer NOT NULL,
    nome character varying(50),
    slug character varying(50),
    icone character varying(50),
    tema_class character varying(50),
    ordem integer
);


ALTER TABLE public.turnos OWNER TO postgres;

--
-- Name: turnos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.turnos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.turnos_id_seq OWNER TO postgres;

--
-- Name: turnos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.turnos_id_seq OWNED BY public.turnos.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    nome character varying(100),
    email character varying(100),
    senha character varying(100),
    tipo character varying(20) DEFAULT 'admin'::character varying,
    token_acesso character varying(50),
    curso_responsavel_id integer,
    unidade_responsavel character varying(50)
);


ALTER TABLE public.usuarios OWNER TO postgres;

--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usuarios_id_seq OWNER TO postgres;

--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: cursos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cursos ALTER COLUMN id SET DEFAULT nextval('public.cursos_id_seq'::regclass);


--
-- Name: disciplinas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.disciplinas ALTER COLUMN id SET DEFAULT nextval('public.disciplinas_id_seq'::regclass);


--
-- Name: grade id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade ALTER COLUMN id SET DEFAULT nextval('public.grade_id_seq'::regclass);


--
-- Name: professores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.professores ALTER COLUMN id SET DEFAULT nextval('public.professores_id_seq'::regclass);


--
-- Name: turmas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turmas ALTER COLUMN id SET DEFAULT nextval('public.turmas_id_seq'::regclass);


--
-- Name: turnos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turnos ALTER COLUMN id SET DEFAULT nextval('public.turnos_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Data for Name: cursos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cursos (id, nome, semestres_total, coordenador) FROM stdin;
1	Ciência da Computação	\N	\N
2	Administração	8	Erica Harbs
3	Direito	8	Miria e Cleyber
4	Biomedicina	8	Carla Danielle Dias Costa
6	Arquitetura e Urbanismo	10	Coordenação Arquitetura
8	Enfermagem	10	Coordenação Enfermagem
\.


--
-- Data for Name: disciplinas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.disciplinas (id, nome, carga_horaria) FROM stdin;
1	Lógica Computacional	\N
2	Engenharia de Software	\N
3	Orientação a Objetos	\N
4	Bioestatística	\N
5	Deontologia e Legislação em Biomedicina	\N
6	Biossegurança	\N
7	Genética e Embriologia Humana	\N
8	Matemática	\N
9	Metodologia Científica	\N
10	Ciências Sociais	\N
11	Políticas de Saúde	\N
12	Patologia	\N
13	Hematologia e Hemoterapia	\N
14	Fisiologia	\N
15	Farmacologia	\N
16	Bioquímica	\N
17	Epidemiologia	\N
18	Análise de Fluidos Biológicos I	\N
19	Diagnóstico por Imagem	\N
20	Projeto Integrador I	\N
21	Hematologia Clínica	\N
22	Estágio Supervisionado I	\N
23	Citopatologia	\N
54	Desenho e Plástica	\N
55	Estética e História da Arte	\N
56	Fundamentos da Metodologia de Projeto	\N
57	Geometria Construtiva	\N
58	Ateliê de Introdução ao Projeto	\N
59	Estudos Ambientais e Bioclimatismo	\N
60	Topografia	\N
61	Ateliê de Projeto Integrado II	\N
62	THAU II	\N
63	Representação Gráfica e Digital I	\N
64	Materiais e Sistemas Construtivos II	\N
65	Planejamento de Habitação de Interesse Social	\N
66	Sistemas Estruturais II	\N
67	THAU IV	\N
68	Ateliê de Projeto Integrado IV	\N
69	Representação Gráfica Digital III	\N
70	Conforto Luminoso	\N
71	Ateliê Urbano e Extensão I	\N
72	Infraestrutura Urbana e Sustentabilidade	\N
73	Projeto Paisagístico I	\N
74	Planejamento Urbano e Regional I	\N
75	Teoria da Preservação de Bens Culturais	\N
76	Introdução ao Geoprocessamento Ambiental	\N
77	Técnicas de Apresentação de Projeto	\N
78	Ateliê de Projeto Integrado VIII	\N
79	Estágio Supervisionado	\N
80	TFG I	\N
81	Ensaio Teórico	\N
82	Tópicos Especiais em Arquitetura	\N
83	TFG II	\N
204	Nutrição Humana	\N
205	Fisiologia Humana	\N
206	Fundamentação do Processo do Cuidar I	\N
211	Cuidado em Doenças e Agravos Transmissíveis	\N
212	Enfermagem na Estratégia da Saúde da Família	\N
213	Cuidado Integral à Saúde do Adulto 2	\N
215	Cuidado Integral em Situações Críticas	\N
216	Cuidado Integral a Criança e ao Adolescente	\N
217	Projeto Integrador III	\N
218	Cuidado Integral em Saúde Mental	\N
219	Processo Integrativo do Cuidado 1	\N
220	Cuidado Integral a Saúde do Trabalhador	\N
222	TCC II	\N
223	Estágio Supervisionado II	\N
224	Processo Integrativo do Cuidado 3	\N
226	Nutrição Humana (Quinzenal)	\N
230	Farmacologia (Quinzenal)	\N
238	Projeto Integrador I (Quinzenal)	\N
242	Projeto Integrador III (Quinzenal)	\N
244	Cuidado Integral em Saúde Mental (Quinzenal)	\N
246	Processo Integrativo do Cuidado 1 (Quinzenal)	\N
251	Processo Integrativo do Cuidado 3 (Quinzenal)	\N
402	Filosofia Jurídica e História do Direito	\N
403	Língua Portuguesa e Comunicação Jurídica	\N
404	Teoria Geral do Estado	\N
405	Metodologia Científica na Era Digital	\N
406	Introdução ao Estudo do Direito	\N
407	Ciência Política	\N
408	Direito Penal I	\N
409	Direito Civil I	\N
410	Direito Constitucional I	\N
411	Filosofia Geral e Jurídica	\N
413	Direito Penal II	\N
414	Direito Constitucional II	\N
416	Direito Processual Civil I - Parte Geral	\N
417	Direito Civil II - Obrigações	\N
418	Estatuto da Criança e do Adolescente	\N
419	Psicologia Geral e Jurídica	\N
420	Direito Civil III - Contratos	\N
421	Direito do Trabalho I	\N
422	Direito Penal III	\N
423	Direito Constitucional III	\N
424	Direito Processual Civil II - Processo de Conhecimento	\N
425	Projeto Integrador II	\N
426	Direitos Humanos	\N
427	Direito Processual Penal I	\N
428	Direito Penal IV	\N
430	Direito do Trabalho II	\N
431	Direito Processual Civil III - Meios de Impugnação	\N
432	Direito Civil IV - Coisas	\N
433	Direito do Consumidor	\N
434	Direito Civil V - Família	\N
435	Direito Empresarial I	\N
436	Direito Processual Civil IV - Processo de Execução	\N
437	Direito Processual do Trabalho	\N
438	Direito Processual Penal II	\N
439	Projeto Integrador IV	\N
440	Direito da Propriedade Intelectual	\N
441	Direito Processual Civil V - Procedimentos Especiais	\N
442	Direito Processual Penal III	\N
443	Direito Civil VI - Sucessões	\N
444	Direito Empresarial II	\N
445	Projeto Integrador V	\N
446	Estágio Supervisionado Simulado I - Cível	\N
447	Direito da Seguridade Social	\N
448	Direito Administrativo I	\N
449	Estágio Supervisionado Simulado II - Penal	\N
450	Laboratório de Conciliação, Mediação e Arbitragem	\N
451	Ética Geral e Jurídica	\N
452	Direito Internacional Público e Privado	\N
453	Projeto Integrador VI	\N
454	Estágio Supervisionado Real I	\N
455	Trabalho de Conclusão de Curso I	\N
456	História do Direito	\N
457	Antropologia Geral e Jurídica	\N
458	Leitura e Produção de Textos	\N
460	Economia	\N
461	Estágio Supervisionado Simulado III - Trabalho	\N
462	Direito Administrativo II	\N
463	Direito Ambiental	\N
464	Estágio Supervisionado Real II	\N
465	Trabalho de Conclusão de Curso II	\N
466	Projeto Integrador VII	\N
467	Estágio Supervisionado Simulado IV - Tributário	\N
468	Estágio Supervisionado Real III	\N
469	Seminários Integradores	\N
470	Direito Digital e Novas Tecnologias	\N
471	Direito Eleitoral	\N
\.


--
-- Data for Name: grade; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grade (id, turma_id, dia_semana, disciplina_id, professor_id, icone_dia, nota_compartilhada, e_livre, e_split, sala) FROM stdin;
1	1	SEG	1	1	fa-calendar	\N	f	f	\N
3	3	SEG	3	1	fa-calendar	\N	f	f	1
4	1	TER	2	3	fa-calendar	\N	f	f	
6	1	QUA	3	2	fa-calendar	\N	f	f	sala 210
477	48	SEG	58	29	fa-calendar	\N	f	f	\N
1062	102	TER	226	81	fa-calendar	\N	f	f	\N
17	6	TER	13	8	fa-calendar	\N	f	f	\N
1063	102	TER	226	81	fa-calendar	\N	f	f	\N
19	6	QUA	14	4	fa-calendar	\N	f	f	\N
20	6	QUI	15	8	fa-calendar	\N	f	f	\N
21	6	SEX	6	9	fa-calendar	\N	f	f	\N
22	7	SEG	11	7	fa-calendar	\N	f	f	\N
24	7	TER	4	15	fa-calendar	\N	f	f	\N
25	7	QUA	7	16	fa-calendar	\N	f	f	\N
26	7	QUI	5	5	fa-calendar	\N	f	f	\N
27	7	QUI	6	9	fa-calendar	\N	f	f	\N
476	48	SEG	58	29	fa-calendar	\N	f	f	\N
475	48	SEG	58	29	fa-calendar	\N	f	f	\N
30	8	SEG	15	11	fa-calendar	\N	f	f	\N
31	8	TER	6	12	fa-calendar	\N	f	f	\N
32	8	QUA	13	8	fa-calendar	\N	f	f	\N
1064	102	QUA	205	4	fa-calendar	\N	f	f	\N
34	8	QUI	14	13	fa-calendar	\N	f	f	\N
1065	102	QUA	205	4	fa-calendar	\N	f	f	\N
1066	102	QUA	205	4	fa-calendar	\N	f	f	\N
37	9	SEG	18	8	fa-calendar	\N	f	f	\N
38	9	TER	19	14	fa-calendar	\N	f	f	\N
39	9	TER	22	5	fa-calendar	\N	f	f	\N
40	9	QUA	20	11	fa-calendar	\N	f	f	\N
41	9	QUA	23	6	fa-calendar	\N	f	f	\N
42	9	QUI	21	6	fa-calendar	\N	f	f	\N
1067	102	QUI	206	83	fa-calendar	\N	f	f	\N
1068	102	QUI	206	83	fa-calendar	\N	f	f	\N
23	7	TER	8	\N	fa-calendar	\N	f	f	EAD
474	48	SEG	58	29	fa-calendar	\N	f	f	\N
481	48	TER	56	29	fa-calendar	\N	f	f	\N
1069	102	QUI	206	83	fa-calendar	\N	f	f	\N
1070	102	QUI	206	83	fa-calendar	\N	f	f	\N
480	48	TER	56	29	fa-calendar	\N	f	f	\N
85	5	SEX	8	\N	fa-calendar	\N	f	f	EAD
86	5	SEX	8	\N	fa-calendar	\N	f	f	EAD
87	5	SEX	11	7	fa-calendar	\N	f	f	
1072	102	SEX	230	8	fa-calendar	\N	f	f	\N
1073	102	SEX	230	8	fa-calendar	\N	f	f	\N
1075	103	SEG	211	\N	fa-calendar	\N	f	f	\N
1076	103	SEG	211	\N	fa-calendar	\N	f	f	\N
1077	103	SEG	211	\N	fa-calendar	\N	f	f	\N
1078	103	SEG	211	\N	fa-calendar	\N	f	f	\N
1079	103	TER	212	86	fa-calendar	\N	f	f	\N
1080	103	TER	212	86	fa-calendar	\N	f	f	\N
1081	103	TER	212	86	fa-calendar	\N	f	f	\N
1082	103	TER	212	86	fa-calendar	\N	f	f	\N
1083	103	QUI	213	87	fa-calendar	\N	f	f	\N
1084	103	QUI	213	87	fa-calendar	\N	f	f	\N
1085	103	QUI	213	87	fa-calendar	\N	f	f	\N
73	5	SEG	4	4	fa-calendar	\N	f	f	\N
74	5	SEG	4	4	fa-calendar	\N	f	f	\N
76	5	TER	5	5	fa-calendar	\N	f	f	\N
77	5	TER	5	5	fa-calendar	\N	f	f	\N
80	5	QUA	6	6	fa-calendar	\N	f	f	\N
81	5	QUA	6	6	fa-calendar	\N	f	f	\N
83	5	QUI	7	4	fa-calendar	\N	f	f	\N
84	5	QUI	7	4	fa-calendar	\N	f	f	\N
1086	103	QUI	213	87	fa-calendar	\N	f	f	\N
1087	103	SEX	238	87	fa-calendar	\N	f	f	\N
1088	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1089	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1090	\N	SEG	215	83	fa-calendar	\N	f	f	\N
504	52	TER	55	28	fa-calendar	\N	f	f	\N
1092	\N	TER	216	88	fa-calendar	\N	f	f	\N
1093	\N	TER	216	88	fa-calendar	\N	f	f	\N
1094	\N	TER	216	88	fa-calendar	\N	f	f	\N
1095	\N	TER	216	88	fa-calendar	\N	f	f	\N
1096	\N	QUA	242	87	fa-calendar	\N	f	f	\N
503	52	TER	55	28	fa-calendar	\N	f	f	\N
479	48	TER	55	28	fa-calendar	\N	f	f	\N
478	48	TER	55	28	fa-calendar	\N	f	f	\N
1097	\N	QUI	244	88	fa-calendar	\N	f	f	\N
1098	\N	SEX	246	89	fa-calendar	\N	f	f	\N
484	48	QUA	57	28	fa-calendar	\N	f	f	\N
483	48	QUA	57	28	fa-calendar	\N	f	f	\N
520	56	SEG	82	\N	fa-calendar	\N	f	f	\N
882	108	SEG	212	86	fa-calendar	\N	f	f	\N
883	108	TER	213	87	fa-calendar	\N	f	f	\N
884	108	QUI	211	86	fa-calendar	\N	f	f	\N
885	108	SEX	238	87	fa-calendar	\N	f	f	\N
886	109	SEG	215	83	fa-calendar	\N	f	f	\N
1099	105	SEG	22	\N	fa-calendar	\N	f	f	\N
888	109	TER	216	88	fa-calendar	\N	f	f	\N
889	109	QUA	246	87	fa-calendar	\N	f	f	\N
890	109	QUI	244	88	fa-calendar	\N	f	f	\N
891	109	SEX	242	87	fa-calendar	\N	f	f	\N
892	110	SEG	230	11	fa-calendar	\N	f	f	\N
1100	105	SEG	22	\N	fa-calendar	\N	f	f	\N
894	110	TER	226	81	fa-calendar	\N	f	f	\N
1101	105	SEG	22	\N	fa-calendar	\N	f	f	\N
896	110	QUA	206	83	fa-calendar	\N	f	f	\N
897	110	QUA	206	83	fa-calendar	\N	f	f	\N
898	110	SEX	205	4	fa-calendar	\N	f	f	\N
1102	105	SEG	22	\N	fa-calendar	\N	f	f	\N
900	111	SEG	216	88	fa-calendar	\N	f	f	\N
1103	105	TER	22	\N	fa-calendar	\N	f	f	\N
902	111	TER	215	83	fa-calendar	\N	f	f	\N
903	111	QUA	242	86	fa-calendar	\N	f	f	\N
904	111	QUI	218	88	fa-calendar	\N	f	f	\N
905	111	SEX	246	89	fa-calendar	\N	f	f	\N
906	112	SEG	22	\N	fa-calendar	\N	f	f	\N
907	112	TER	22	\N	fa-calendar	\N	f	f	\N
908	112	QUA	22	\N	fa-calendar	\N	f	f	\N
909	112	QUI	22	\N	fa-calendar	\N	f	f	\N
910	112	SEX	222	89	fa-calendar	\N	f	f	\N
1104	105	TER	22	\N	fa-calendar	\N	f	f	\N
1105	105	TER	22	\N	fa-calendar	\N	f	f	\N
1106	105	TER	22	\N	fa-calendar	\N	f	f	\N
1107	105	QUA	22	\N	fa-calendar	\N	f	f	\N
1108	105	QUA	22	\N	fa-calendar	\N	f	f	\N
1109	105	QUA	22	\N	fa-calendar	\N	f	f	\N
1110	105	QUA	22	\N	fa-calendar	\N	f	f	\N
1111	105	QUI	22	\N	fa-calendar	\N	f	f	\N
1112	105	QUI	22	\N	fa-calendar	\N	f	f	\N
1113	105	QUI	22	\N	fa-calendar	\N	f	f	\N
1114	105	QUI	22	\N	fa-calendar	\N	f	f	\N
1115	105	SEX	222	89	fa-calendar	\N	f	f	\N
1116	106	SEG	223	\N	fa-calendar	\N	f	f	\N
1117	106	SEG	223	\N	fa-calendar	\N	f	f	\N
1118	106	SEG	223	\N	fa-calendar	\N	f	f	\N
1119	106	SEG	223	\N	fa-calendar	\N	f	f	\N
1120	106	TER	223	\N	fa-calendar	\N	f	f	\N
1121	106	TER	223	\N	fa-calendar	\N	f	f	\N
1122	106	TER	223	\N	fa-calendar	\N	f	f	\N
1123	106	TER	223	\N	fa-calendar	\N	f	f	\N
1124	106	QUA	223	\N	fa-calendar	\N	f	f	\N
1125	106	QUA	223	\N	fa-calendar	\N	f	f	\N
1126	106	QUA	223	\N	fa-calendar	\N	f	f	\N
1127	106	QUA	223	\N	fa-calendar	\N	f	f	\N
932	\N	SEG	215	83	fa-calendar	\N	f	f	\N
933	\N	SEG	215	83	fa-calendar	\N	f	f	\N
935	\N	TER	216	88	fa-calendar	\N	f	f	\N
936	\N	TER	216	88	fa-calendar	\N	f	f	\N
937	\N	QUA	242	87	fa-calendar	\N	f	f	\N
938	\N	QUA	242	87	fa-calendar	\N	f	f	\N
939	\N	QUI	244	88	fa-calendar	\N	f	f	\N
940	\N	QUI	244	88	fa-calendar	\N	f	f	\N
941	\N	SEX	246	89	fa-calendar	\N	f	f	\N
942	\N	SEX	246	89	fa-calendar	\N	f	f	\N
1128	106	QUI	223	\N	fa-calendar	\N	f	f	\N
1129	106	QUI	223	\N	fa-calendar	\N	f	f	\N
1130	106	QUI	223	\N	fa-calendar	\N	f	f	\N
1131	106	QUI	223	\N	fa-calendar	\N	f	f	\N
1132	106	SEX	251	83	fa-calendar	\N	f	f	\N
1091	\N	SEG	220	\N	fa-calendar	\N	f	f	EAD
450	54	QUI	58	29	fa-calendar	\N	f	f	\N
449	54	QUI	58	29	fa-calendar	\N	f	f	\N
445	54	TER	56	29	fa-calendar	\N	f	f	\N
444	54	TER	55	28	fa-calendar	\N	f	f	\N
443	54	TER	55	28	fa-calendar	\N	f	f	\N
448	54	QUA	57	30	fa-calendar	\N	f	f	\N
447	54	QUA	57	30	fa-calendar	\N	f	f	\N
446	54	QUA	57	30	fa-calendar	\N	f	f	\N
482	48	QUA	57	28	fa-calendar	\N	f	f	\N
442	54	SEG	54	27	fa-calendar	\N	f	f	\N
441	54	SEG	54	27	fa-calendar	\N	f	f	\N
440	54	SEG	54	27	fa-calendar	\N	f	f	\N
487	48	QUI	54	27	fa-calendar	\N	f	f	\N
486	48	QUI	54	27	fa-calendar	\N	f	f	\N
485	48	QUI	54	27	fa-calendar	\N	f	f	\N
489	49	SEG	59	31	fa-calendar	\N	f	f	\N
488	49	SEG	59	31	fa-calendar	\N	f	f	\N
687	\N	SEG	220	\N	fa-calendar	\N	f	f	EAD
1061	102	SEG	16	\N	fa-calendar	\N	f	f	EAD
1071	102	QUI	17	\N	fa-calendar	\N	f	f	EAD
491	49	SEG	60	31	fa-calendar	\N	f	f	\N
490	49	SEG	60	31	fa-calendar	\N	f	f	\N
495	49	QUA	61	36	fa-calendar	\N	f	f	\N
494	49	QUA	61	36	fa-calendar	\N	f	f	\N
493	49	QUA	61	36	fa-calendar	\N	f	f	\N
492	49	QUA	61	36	fa-calendar	\N	f	f	\N
497	49	QUI	62	36	fa-calendar	\N	f	f	\N
496	49	QUI	62	36	fa-calendar	\N	f	f	\N
499	49	QUI	63	34	fa-calendar	\N	f	f	\N
498	49	QUI	63	34	fa-calendar	\N	f	f	\N
502	49	SEX	64	33	fa-calendar	\N	f	f	\N
501	49	SEX	64	33	fa-calendar	\N	f	f	\N
1074	102	SEX	12	\N	fa-calendar	\N	f	f	EAD
500	49	SEX	64	33	fa-calendar	\N	f	f	\N
453	55	SEG	65	32	fa-calendar	\N	f	f	\N
452	55	SEG	65	32	fa-calendar	\N	f	f	\N
451	55	SEG	65	32	fa-calendar	\N	f	f	\N
401	50	SEG	65	32	fa-calendar	\N	f	f	\N
400	50	SEG	65	32	fa-calendar	\N	f	f	\N
399	50	SEG	65	32	fa-calendar	\N	f	f	\N
454	55	TER	66	33	fa-calendar	\N	f	f	\N
403	50	TER	66	33	fa-calendar	\N	f	f	\N
402	50	TER	66	33	fa-calendar	\N	f	f	\N
456	55	TER	67	28	fa-calendar	\N	f	f	\N
455	55	TER	67	28	fa-calendar	\N	f	f	\N
405	50	TER	67	28	fa-calendar	\N	f	f	\N
404	50	TER	67	28	fa-calendar	\N	f	f	\N
459	55	QUA	68	34	fa-calendar	\N	f	f	\N
458	55	QUA	68	34	fa-calendar	\N	f	f	\N
457	55	QUA	68	34	fa-calendar	\N	f	f	\N
409	50	QUA	68	34	fa-calendar	\N	f	f	\N
408	50	QUA	68	34	fa-calendar	\N	f	f	\N
407	50	QUA	68	34	fa-calendar	\N	f	f	\N
406	50	QUA	68	34	fa-calendar	\N	f	f	\N
460	55	QUI	69	31	fa-calendar	\N	f	f	\N
411	50	QUI	69	31	fa-calendar	\N	f	f	\N
410	50	QUI	69	31	fa-calendar	\N	f	f	\N
462	55	QUI	70	31	fa-calendar	\N	f	f	\N
461	55	QUI	70	31	fa-calendar	\N	f	f	\N
1005	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1006	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1007	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1009	\N	TER	216	88	fa-calendar	\N	f	f	\N
1010	\N	TER	216	88	fa-calendar	\N	f	f	\N
1011	\N	TER	216	88	fa-calendar	\N	f	f	\N
1012	\N	TER	216	88	fa-calendar	\N	f	f	\N
1013	\N	QUA	242	87	fa-calendar	\N	f	f	\N
1014	\N	QUI	244	88	fa-calendar	\N	f	f	\N
1015	\N	SEX	246	89	fa-calendar	\N	f	f	\N
413	50	QUI	70	31	fa-calendar	\N	f	f	\N
412	50	QUI	70	31	fa-calendar	\N	f	f	\N
421	51	QUA	71	27	fa-calendar	\N	f	f	\N
420	51	QUA	71	27	fa-calendar	\N	f	f	\N
419	51	QUA	71	27	fa-calendar	\N	f	f	\N
416	51	SEG	71	27	fa-calendar	\N	f	f	\N
415	51	SEG	71	27	fa-calendar	\N	f	f	\N
414	51	SEG	71	27	fa-calendar	\N	f	f	\N
418	51	TER	72	29	fa-calendar	\N	f	f	\N
417	51	TER	72	29	fa-calendar	\N	f	f	\N
423	51	QUI	73	34	fa-calendar	\N	f	f	\N
422	51	QUI	73	34	fa-calendar	\N	f	f	\N
1222	104	SEG	215	83	fa-calendar	\N	f	f	\N
1223	104	SEG	215	83	fa-calendar	\N	f	f	\N
1224	104	SEG	215	83	fa-calendar	\N	f	f	\N
1225	104	TER	216	88	fa-calendar	\N	f	f	\N
1226	104	TER	216	88	fa-calendar	\N	f	f	\N
1227	104	TER	216	88	fa-calendar	\N	f	f	\N
1229	104	QUA	218	88	fa-calendar	\N	f	f	\N
1230	104	QUA	218	88	fa-calendar	\N	f	f	\N
1231	104	SEX	242	87	fa-calendar	\N	f	f	\N
1232	104	SEX	242	87	fa-calendar	\N	f	f	\N
1233	104	SEX	246	89	fa-calendar	\N	f	f	\N
1234	104	SEX	246	89	fa-calendar	\N	f	f	\N
887	109	SEG	220	\N	fa-calendar	\N	f	f	EAD
901	111	SEG	220	\N	fa-calendar	\N	f	f	EAD
934	\N	SEG	220	\N	fa-calendar	\N	f	f	EAD
1008	\N	SEG	220	\N	fa-calendar	\N	f	f	EAD
1053	\N	SEG	220	\N	fa-calendar	\N	f	f	EAD
1228	104	TER	220	\N	fa-calendar	\N	f	f	EAD
425	51	QUI	75	36	fa-calendar	\N	f	f	\N
424	51	QUI	75	36	fa-calendar	\N	f	f	\N
427	51	SEX	74	32	fa-calendar	\N	f	f	\N
1238	107	QUA	206	83	fa-calendar	\N	f	f	\N
1239	107	QUA	206	83	fa-calendar	\N	f	f	\N
1050	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1051	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1052	\N	SEG	215	83	fa-calendar	\N	f	f	\N
1054	\N	TER	216	88	fa-calendar	\N	f	f	\N
1055	\N	TER	216	88	fa-calendar	\N	f	f	\N
1056	\N	TER	216	88	fa-calendar	\N	f	f	\N
1057	\N	TER	216	88	fa-calendar	\N	f	f	\N
1058	\N	QUA	242	87	fa-calendar	\N	f	f	\N
1059	\N	QUI	244	88	fa-calendar	\N	f	f	\N
1060	\N	SEX	246	89	fa-calendar	\N	f	f	\N
426	51	SEX	74	32	fa-calendar	\N	f	f	\N
429	51	SEX	76	31	fa-calendar	\N	f	f	\N
428	51	SEX	76	31	fa-calendar	\N	f	f	\N
506	52	TER	77	34	fa-calendar	\N	f	f	\N
505	52	TER	77	34	fa-calendar	\N	f	f	\N
515	53	QUI	78	29	fa-calendar	\N	f	f	\N
514	53	QUI	78	29	fa-calendar	\N	f	f	\N
509	52	QUI	78	29	fa-calendar	\N	f	f	\N
508	52	QUI	78	29	fa-calendar	\N	f	f	\N
507	52	QUI	78	29	fa-calendar	\N	f	f	\N
1240	107	QUA	206	83	fa-calendar	\N	f	f	\N
1241	107	QUA	206	83	fa-calendar	\N	f	f	\N
1242	107	QUI	205	13	fa-calendar	\N	f	f	\N
1243	107	QUI	205	13	fa-calendar	\N	f	f	\N
1244	107	QUI	205	13	fa-calendar	\N	f	f	\N
1245	107	QUI	205	13	fa-calendar	\N	f	f	\N
1246	107	SEX	230	11	fa-calendar	\N	f	f	\N
1247	107	SEX	230	11	fa-calendar	\N	f	f	\N
1248	107	SEX	226	7	fa-calendar	\N	f	f	\N
1249	107	SEX	226	7	fa-calendar	\N	f	f	\N
1235	107	SEG	17	\N	fa-calendar	\N	f	f	EAD
1236	107	SEG	16	\N	fa-calendar	\N	f	f	EAD
1237	107	SEG	12	\N	fa-calendar	\N	f	f	EAD
893	110	SEG	12	\N	fa-calendar	\N	f	f	EAD
895	110	TER	17	\N	fa-calendar	\N	f	f	EAD
899	110	SEX	16	\N	fa-calendar	\N	f	f	EAD
528	56	QUI	81	32	fa-calendar	\N	f	f	\N
527	56	QUI	81	32	fa-calendar	\N	f	f	\N
526	56	QUI	81	32	fa-calendar	\N	f	f	\N
525	56	QUI	81	32	fa-calendar	\N	f	f	\N
513	53	QUA	81	35	fa-calendar	\N	f	f	\N
516	53	SEX	79	35	fa-calendar	\N	f	f	\N
511	52	SEX	79	35	fa-calendar	\N	f	f	\N
510	52	SEX	79	35	fa-calendar	\N	f	f	\N
519	56	SEG	82	\N	fa-calendar	\N	f	f	\N
518	56	SEG	82	\N	fa-calendar	\N	f	f	\N
517	56	SEG	82	\N	fa-calendar	\N	f	f	\N
524	56	QUA	80	35	fa-calendar	\N	f	f	\N
523	56	QUA	80	35	fa-calendar	\N	f	f	\N
522	56	QUA	80	35	fa-calendar	\N	f	f	\N
521	56	QUA	80	35	fa-calendar	\N	f	f	\N
512	53	QUA	80	35	fa-calendar	\N	f	f	\N
473	57	SEX	83	35	fa-calendar	\N	f	f	\N
472	57	SEX	83	35	fa-calendar	\N	f	f	\N
5627	653	SEG	402	407	fa-calendar	\N	f	f	\N
5626	653	SEG	402	407	fa-calendar	\N	f	f	\N
5629	653	TER	403	408	fa-calendar	\N	f	f	\N
5628	653	TER	403	408	fa-calendar	\N	f	f	\N
5631	653	QUA	404	409	fa-calendar	\N	f	f	\N
5690	658	TER	402	407	fa-calendar	\N	f	f	\N
5689	658	TER	402	407	fa-calendar	\N	f	f	\N
5688	658	TER	402	407	fa-calendar	\N	f	f	\N
5695	658	QUI	403	408	fa-calendar	\N	f	f	\N
5694	658	QUI	403	408	fa-calendar	\N	f	f	\N
5693	658	QUI	403	408	fa-calendar	\N	f	f	\N
5692	658	QUA	404	432	fa-calendar	\N	f	f	\N
5691	658	QUA	404	432	fa-calendar	\N	f	f	\N
5630	653	QUA	404	409	fa-calendar	\N	f	f	\N
5687	658	SEG	405	410	fa-calendar	\N	f	f	\N
5686	658	SEG	405	410	fa-calendar	\N	f	f	\N
5633	653	QUI	405	410	fa-calendar	\N	f	f	\N
5632	653	QUI	405	410	fa-calendar	\N	f	f	\N
5697	658	SEX	406	409	fa-calendar	\N	f	f	\N
5696	658	SEX	406	409	fa-calendar	\N	f	f	\N
5635	653	SEX	406	409	fa-calendar	\N	f	f	\N
5634	653	SEX	406	409	fa-calendar	\N	f	f	\N
3899	513	SEG	408	427	fa-calendar	\N	f	f	\N
5700	659	SEG	413	411	fa-calendar	\N	f	f	\N
5699	659	SEG	413	411	fa-calendar	\N	f	f	\N
5638	654	SEG	413	411	fa-calendar	\N	f	f	\N
5637	654	SEG	413	411	fa-calendar	\N	f	f	\N
5704	659	TER	414	412	fa-calendar	\N	f	f	\N
5703	659	TER	414	412	fa-calendar	\N	f	f	\N
5702	659	TER	414	412	fa-calendar	\N	f	f	\N
5641	654	TER	414	412	fa-calendar	\N	f	f	\N
5640	654	TER	414	412	fa-calendar	\N	f	f	\N
5639	654	SEG	20	581	fa-calendar	\N	f	f	\N
5710	659	QUI	416	421	fa-calendar	\N	f	f	\N
5709	659	QUI	416	421	fa-calendar	\N	f	f	\N
5658	655	QUI	217	419	fa-calendar	\N	f	f	\N
5708	659	QUI	416	421	fa-calendar	\N	f	f	\N
5701	659	SEG	20	581	fa-calendar	\N	f	f	\N
5718	660	TER	217	416	fa-calendar	\N	f	f	\N
5752	662	QUI	9	\N	fa-calendar	\N	f	f	EAD
5636	653	SEX	407	\N	fa-calendar	\N	f	f	EAD
5754	662	QUI	407	\N	fa-calendar	\N	f	f	EAD
5698	658	SEX	407	\N	fa-calendar	\N	f	f	EAD
3901	513	SEG	408	427	fa-calendar	\N	f	f	\N
3900	513	SEG	408	427	fa-calendar	\N	f	f	\N
3904	513	TER	409	418	fa-calendar	\N	f	f	\N
3903	513	TER	409	418	fa-calendar	\N	f	f	\N
3902	513	TER	409	418	fa-calendar	\N	f	f	\N
3907	513	QUA	410	412	fa-calendar	\N	f	f	\N
3906	513	QUA	410	412	fa-calendar	\N	f	f	\N
3905	513	QUA	410	412	fa-calendar	\N	f	f	\N
5643	654	QUA	416	413	fa-calendar	\N	f	f	\N
5642	654	QUA	416	413	fa-calendar	\N	f	f	\N
5707	659	QUA	417	414	fa-calendar	\N	f	f	\N
5706	659	QUA	417	414	fa-calendar	\N	f	f	\N
5705	659	QUA	417	414	fa-calendar	\N	f	f	\N
5645	654	QUI	417	414	fa-calendar	\N	f	f	\N
5644	654	QUI	417	414	fa-calendar	\N	f	f	\N
5646	654	SEX	418	\N	fa-calendar	\N	f	f	EAD
5711	659	SEX	418	\N	fa-calendar	\N	f	f	EAD
5712	659	SEX	419	\N	fa-calendar	\N	f	f	EAD
5647	654	SEX	419	\N	fa-calendar	\N	f	f	EAD
3911	514	SEG	420	431	fa-calendar	\N	f	f	\N
3912	514	TER	421	429	fa-calendar	\N	f	f	\N
3913	514	QUA	422	427	fa-calendar	\N	f	f	\N
3914	514	QUI	423	424	fa-calendar	\N	f	f	\N
3916	514	SEX	424	430	fa-calendar	\N	f	f	\N
3915	514	QUI	425	424	fa-calendar	\N	f	f	\N
5721	660	QUA	427	427	fa-calendar	\N	f	f	\N
5720	660	QUA	427	427	fa-calendar	\N	f	f	\N
5719	660	QUA	427	427	fa-calendar	\N	f	f	\N
5650	655	SEG	427	415	fa-calendar	\N	f	f	\N
5649	655	SEG	427	415	fa-calendar	\N	f	f	\N
5648	655	SEG	427	415	fa-calendar	\N	f	f	\N
5717	660	TER	428	416	fa-calendar	\N	f	f	\N
5716	660	TER	428	416	fa-calendar	\N	f	f	\N
5652	655	TER	428	416	fa-calendar	\N	f	f	\N
5651	655	TER	428	416	fa-calendar	\N	f	f	\N
3942	518	SEG	402	407	fa-calendar	\N	f	f	\N
3943	518	TER	403	408	fa-calendar	\N	f	f	\N
3947	518	SEX	404	426	fa-calendar	\N	f	f	\N
3946	518	QUI	405	410	fa-calendar	\N	f	f	\N
3944	518	QUA	406	409	fa-calendar	\N	f	f	\N
3952	519	QUI	413	427	fa-calendar	\N	f	f	\N
3948	519	SEG	414	412	fa-calendar	\N	f	f	\N
3951	519	QUA	416	413	fa-calendar	\N	f	f	\N
3949	519	TER	417	418	fa-calendar	\N	f	f	\N
3956	520	TER	427	427	fa-calendar	\N	f	f	\N
3959	520	SEX	428	416	fa-calendar	\N	f	f	\N
3957	520	QUA	430	417	fa-calendar	\N	f	f	\N
5724	660	QUI	430	417	fa-calendar	\N	f	f	\N
5723	660	QUI	430	417	fa-calendar	\N	f	f	\N
5722	660	QUI	430	417	fa-calendar	\N	f	f	\N
5655	655	QUA	430	417	fa-calendar	\N	f	f	\N
5654	655	QUA	430	417	fa-calendar	\N	f	f	\N
5653	655	QUA	430	417	fa-calendar	\N	f	f	\N
3955	520	SEG	431	413	fa-calendar	\N	f	f	\N
5727	660	SEX	431	421	fa-calendar	\N	f	f	\N
5726	660	SEX	431	421	fa-calendar	\N	f	f	\N
5725	660	SEX	431	421	fa-calendar	\N	f	f	\N
5657	655	QUI	431	413	fa-calendar	\N	f	f	\N
5656	655	QUI	431	413	fa-calendar	\N	f	f	\N
3958	520	QUI	432	418	fa-calendar	\N	f	f	\N
5715	660	SEG	432	418	fa-calendar	\N	f	f	\N
5714	660	SEG	432	418	fa-calendar	\N	f	f	\N
5713	660	SEG	432	418	fa-calendar	\N	f	f	\N
5661	655	SEX	432	418	fa-calendar	\N	f	f	\N
5660	655	SEX	432	418	fa-calendar	\N	f	f	\N
5659	655	SEX	432	418	fa-calendar	\N	f	f	\N
5728	660	SEX	433	\N	fa-calendar	\N	f	f	EAD
5662	655	SEX	433	\N	fa-calendar	\N	f	f	EAD
3918	515	SEG	434	414	fa-calendar	\N	f	f	\N
3919	515	TER	435	428	fa-calendar	\N	f	f	\N
3921	515	QUA	436	418	fa-calendar	\N	f	f	\N
3922	515	QUI	437	429	fa-calendar	\N	f	f	\N
3923	515	SEX	438	427	fa-calendar	\N	f	f	\N
3920	515	TER	439	428	fa-calendar	\N	f	f	\N
3962	521	SEG	441	421	fa-calendar	\N	f	f	\N
5731	661	SEG	441	420	fa-calendar	\N	f	f	\N
5730	661	SEG	441	420	fa-calendar	\N	f	f	\N
5729	661	SEG	441	420	fa-calendar	\N	f	f	\N
5665	656	SEG	441	420	fa-calendar	\N	f	f	\N
5664	656	SEG	441	420	fa-calendar	\N	f	f	\N
5663	656	SEG	441	420	fa-calendar	\N	f	f	\N
5736	661	QUA	442	416	fa-calendar	\N	f	f	\N
5735	661	QUA	442	416	fa-calendar	\N	f	f	\N
5667	656	TER	442	416	fa-calendar	\N	f	f	\N
5666	656	TER	442	416	fa-calendar	\N	f	f	\N
5740	661	QUI	443	414	fa-calendar	\N	f	f	\N
5739	661	QUI	443	414	fa-calendar	\N	f	f	\N
5738	661	QUI	443	414	fa-calendar	\N	f	f	\N
5669	656	QUA	443	414	fa-calendar	\N	f	f	\N
5668	656	QUA	443	414	fa-calendar	\N	f	f	\N
3964	521	QUA	444	428	fa-calendar	\N	f	f	\N
5743	661	SEX	444	431	fa-calendar	\N	f	f	\N
5742	661	SEX	444	431	fa-calendar	\N	f	f	\N
5741	661	SEX	444	431	fa-calendar	\N	f	f	\N
5671	656	QUI	444	421	fa-calendar	\N	f	f	\N
5670	656	QUI	444	421	fa-calendar	\N	f	f	\N
3965	521	QUA	445	428	fa-calendar	\N	f	f	\N
5737	661	QUA	445	422	fa-calendar	\N	f	f	\N
3950	519	TER	20	418	fa-calendar	\N	f	f	\N
5672	656	QUI	445	422	fa-calendar	\N	f	f	\N
3963	521	TER	446	413	fa-calendar	\N	f	f	\N
5734	661	TER	446	420	fa-calendar	\N	f	f	\N
5733	661	TER	446	420	fa-calendar	\N	f	f	\N
5732	661	TER	446	420	fa-calendar	\N	f	f	\N
5674	656	SEX	446	420	fa-calendar	\N	f	f	\N
5673	656	SEX	446	420	fa-calendar	\N	f	f	\N
5675	656	SEX	447	\N	fa-calendar	\N	f	f	EAD
5744	661	SEX	447	\N	fa-calendar	\N	f	f	EAD
3925	516	SEG	448	424	fa-calendar	\N	f	f	\N
3926	516	TER	449	427	fa-calendar	\N	f	f	\N
3928	516	QUI	450	420	fa-calendar	\N	f	f	\N
3927	516	QUA	452	407	fa-calendar	\N	f	f	\N
3929	516	QUI	453	420	fa-calendar	\N	f	f	\N
3932	516	SEX	454	\N	fa-calendar	\N	f	f	\N
5747	662	TER	456	407	fa-calendar	\N	f	f	\N
5746	662	TER	456	407	fa-calendar	\N	f	f	\N
3960	520	SEX	217	416	fa-calendar	\N	f	f	\N
3909	513	SEX	406	\N	fa-calendar	\N	f	f	EAD
3945	518	QUA	407	\N	fa-calendar	\N	f	f	EAD
3980	523	SEX	407	\N	fa-calendar	\N	f	f	EAD
3910	513	SEX	411	\N	fa-calendar	\N	f	f	EAD
3954	519	SEX	418	\N	fa-calendar	\N	f	f	EAD
3953	519	SEX	419	\N	fa-calendar	\N	f	f	EAD
3917	514	SEX	426	\N	fa-calendar	\N	f	f	EAD
3961	520	SEX	433	\N	fa-calendar	\N	f	f	EAD
3924	515	SEX	440	\N	fa-calendar	\N	f	f	EAD
3966	521	QUI	442	416	fa-calendar	\N	f	f	\N
3967	521	SEX	443	414	fa-calendar	\N	f	f	\N
3968	521	SEX	447	\N	fa-calendar	\N	f	f	EAD
3930	516	SEX	451	\N	fa-calendar	\N	f	f	EAD
3931	516	SEX	455	\N	fa-calendar	\N	f	f	EAD
3975	523	SEG	456	407	fa-calendar	\N	f	f	\N
5745	662	TER	456	407	fa-calendar	\N	f	f	\N
3976	523	TER	457	410	fa-calendar	\N	f	f	\N
5750	662	QUA	457	410	fa-calendar	\N	f	f	\N
5749	662	QUA	457	410	fa-calendar	\N	f	f	\N
5748	662	QUA	457	410	fa-calendar	\N	f	f	\N
3977	523	SEX	458	\N	fa-calendar	\N	f	f	EAD
5751	662	QUI	458	\N	fa-calendar	\N	f	f	EAD
3978	523	SEX	9	\N	fa-calendar	\N	f	f	EAD
75	5	SEG	9	\N	fa-calendar	\N	f	f	EAD
28	7	SEX	9	\N	fa-calendar	\N	f	f	EAD
82	5	QUA	10	\N	fa-calendar	\N	f	f	EAD
29	7	SEX	10	\N	fa-calendar	\N	f	f	EAD
3908	513	SEX	10	\N	fa-calendar	\N	f	f	EAD
3979	523	SEX	460	\N	fa-calendar	\N	f	f	EAD
5753	662	QUI	460	\N	fa-calendar	\N	f	f	EAD
3969	522	SEG	461	423	fa-calendar	\N	f	f	\N
5678	657	SEG	461	423	fa-calendar	\N	f	f	\N
5677	657	SEG	461	423	fa-calendar	\N	f	f	\N
5676	657	SEG	461	423	fa-calendar	\N	f	f	\N
3971	522	TER	462	424	fa-calendar	\N	f	f	\N
5682	657	QUA	462	424	fa-calendar	\N	f	f	\N
5681	657	QUA	462	424	fa-calendar	\N	f	f	\N
5680	657	QUA	462	424	fa-calendar	\N	f	f	\N
3974	522	SEX	463	\N	fa-calendar	\N	f	f	EAD
5683	657	SEX	463	\N	fa-calendar	\N	f	f	EAD
3972	522	SEX	464	\N	fa-calendar	\N	f	f	\N
5684	657	SEX	464	\N	fa-calendar	\N	f	f	\N
3973	522	SEX	465	\N	fa-calendar	\N	f	f	\N
5685	657	SEX	465	\N	fa-calendar	\N	f	f	\N
3970	522	SEG	466	423	fa-calendar	\N	f	f	\N
5679	657	SEG	466	423	fa-calendar	\N	f	f	\N
3938	517	QUI	467	425	fa-calendar	\N	f	f	\N
3937	517	QUI	467	425	fa-calendar	\N	f	f	\N
3936	517	QUI	467	425	fa-calendar	\N	f	f	\N
3939	517	SEX	468	\N	fa-calendar	\N	f	f	\N
3935	517	QUA	469	426	fa-calendar	\N	f	f	\N
3934	517	QUA	469	426	fa-calendar	\N	f	f	\N
3933	517	QUA	469	426	fa-calendar	\N	f	f	\N
3940	517	SEX	470	\N	fa-calendar	\N	f	f	EAD
3941	517	SEX	471	\N	fa-calendar	\N	f	f	EAD
\.


--
-- Data for Name: professores; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.professores (id, nome, email) FROM stdin;
1	Prof. Edward Lima	\N
2	Prof. Jorge Osvaldo	\N
3	José	\N
4	Prof. Dr. Roberto Gomes	\N
5	Profa. Dra. Carla Danielle	\N
6	Prof. Dr. Fabiano	\N
7	Prof. Karina	\N
8	Profa. Dra. Minéia	\N
9	Profa. Dra. Thais Ranielle	\N
10	Prof. Dr. Osmundo	\N
11	Prof. Dr. Breno	\N
12	Prof. Dr. Márcio	\N
13	Prof. Dr. Carlos Janssen	\N
14	Profa. Dra. Flávia Abreu	\N
15	Prof. Angélica	\N
16	Prof. Luzirlane	\N
407	Rodrigo Palma	\N
408	Márcia Bicalho	\N
409	José Roberto Carvalho	\N
410	Alexandre Coelho	\N
411	Kênia Nogueira	\N
412	Fernando Perazzoli	\N
413	Camila Ribeiro	\N
414	Heitor Pessoa	\N
415	Ministra Daniela Teixeira	\N
416	Patrícia Nunes	\N
27	Profa. Luciana	\N
28	Prof. Montiel	\N
29	Profa. Glaucia	\N
30	Prof. Marcelo Monteiro	\N
31	Prof. Marcelo	\N
32	Profa. Marly	\N
33	Profa. Carmen	\N
34	Prof. Lucas	\N
35	Profa. Hiatiane	\N
36	Prof. Tadeu	\N
417	Raquel Mousinho	\N
418	Lizandra Oliveira	\N
419	Ministro Teodoro Silva Santos	\N
420	Andrezza Passani	\N
421	Analice Andrade	\N
422	Ministro Reynaldo da Fonseca	\N
423	Gabriela Nunes	\N
424	Marcelo Cruvinel	\N
425	Bruno Rodrigues	\N
426	Fernando Honorato	\N
427	Eduardo Farias	\N
48	Profa. Luciana	\N
49	Prof. Montiel	\N
50	Profa. Glaucia	\N
51	Prof. Marcelo Monteiro	\N
52	Prof. Marcelo	\N
53	Profa. Marly	\N
54	Profa. Carmen	\N
55	Prof. Lucas	\N
56	Profa. Hiatiane	\N
57	Prof. Tadeu	\N
58	Prof. A Definir	\N
59	Profa. Luciana	\N
60	Prof. Montiel	\N
61	Profa. Glaucia	\N
62	Prof. Marcelo Monteiro	\N
63	Prof. Marcelo	\N
64	Profa. Marly	\N
65	Profa. Carmen	\N
66	Prof. Lucas	\N
67	Profa. Hiatiane	\N
68	Prof. Tadeu	\N
69	Prof. A Definir	\N
70	Profa. Luciana	\N
71	Prof. Montiel	\N
72	Profa. Glaucia	\N
73	Prof. Marcelo Monteiro	\N
74	Prof. Marcelo	\N
75	Profa. Marly	\N
76	Profa. Carmen	\N
77	Prof. Lucas	\N
78	Profa. Hiatiane	\N
79	Prof. Tadeu	\N
80	Prof. A Definir	\N
81	Prof. Dejane	\N
82	Prof. Roberto	\N
83	Prof. Patrícia	\N
84	Prof. Minéia	\N
85	Prof. Breno	\N
86	Prof. Graziani	\N
87	Prof. Euni	\N
88	Prof. Gabriela	\N
89	Prof. Erlayne	\N
90	Prof. Carlos Janssen	\N
91	Prof. Karina	\N
92	Prof. Angélica	\N
93	Prof. Dejane	\N
94	Prof. Roberto	\N
95	Prof. Patrícia	\N
96	Prof. Minéia	\N
97	Prof. Breno	\N
98	Prof. Graziani	\N
99	Prof. Euni	\N
100	Prof. Gabriela	\N
101	Prof. Erlayne	\N
102	Prof. Carlos Janssen	\N
103	Prof. Karina	\N
104	Prof. Angélica	\N
105	Prof. Dejane	\N
106	Prof. Roberto	\N
107	Prof. Patrícia	\N
108	Prof. Minéia	\N
109	Prof. Breno	\N
110	Prof. Graziani	\N
111	Prof. Euni	\N
112	Prof. Gabriela	\N
113	Prof. Erlayne	\N
114	Prof. Carlos Janssen	\N
115	Prof. Karina	\N
116	Prof. Angélica	\N
117	Prof. Dejane	\N
118	Prof. Roberto	\N
119	Prof. Patrícia	\N
120	Prof. Minéia	\N
121	Prof. Breno	\N
122	Prof. Osmundo	\N
123	Prof. Thais Ranielle	\N
124	Prof. Graziani	\N
125	Prof. Euni	\N
126	Prof. Gabriela	\N
127	Prof. Erlayne	\N
128	Prof. Márcio	\N
129	Prof. Carlos Janssen	\N
130	Prof. Karina	\N
131	Prof. Angélica	\N
132	Prof. Luzirlane	\N
133	Prof. Carla Danielle	\N
134	Prof. Fabiano	\N
135	Prof. Flávia Abreu	\N
136	Prof. Dejane	\N
137	Prof. Roberto	\N
138	Prof. Patrícia	\N
139	Prof. Minéia	\N
140	Prof. Breno	\N
141	Prof. Graziani	\N
142	Prof. Euni	\N
143	Prof. Gabriela	\N
144	Prof. Erlayne	\N
145	Prof. Carlos Janssen	\N
146	Prof. Karina	\N
147	Prof. Angélica	\N
428	Danilo Ribeiro	\N
429	Rodrigo Espiuca	\N
430	Bruno Antunes	\N
431	Leonardo Aquino	\N
432	Adriana dos Reis	\N
433	Rodrigo Palma	\N
434	Márcia Bicalho	\N
435	José Roberto Carvalho	\N
436	Alexandre Coelho	\N
437	Kênia Nogueira	\N
438	Fernando Perazzoli	\N
439	Camila Ribeiro	\N
440	Heitor Pessoa	\N
441	Ministra Daniela Teixeira	\N
442	Patrícia Nunes	\N
443	Raquel Mousinho	\N
444	Lizandra Oliveira	\N
445	Ministro Teodoro Silva Santos	\N
446	Andrezza Passani	\N
447	Analice Andrade	\N
448	Ministro Reynaldo da Fonseca	\N
449	Gabriela Nunes	\N
450	Marcelo Cruvinel	\N
451	Bruno Rodrigues	\N
173	Rodrigo Palma	\N
174	Márcia Bicalho	\N
175	José Roberto Carvalho	\N
176	Alexandre Coelho	\N
177	Kênia Nogueira	\N
178	Fernando Perazzoli	\N
179	Camila Ribeiro	\N
180	Heitor Pessoa	\N
181	Ministra Daniela Teixeira	\N
182	Patrícia Nunes	\N
183	Raquel Mousinho	\N
184	Lizandra Oliveira	\N
185	Ministro Teodoro Silva Santos	\N
186	Andrezza Passani	\N
187	Analice Andrade	\N
188	Ministro Reynaldo da Fonseca	\N
189	Gabriela Nunes	\N
190	Marcelo Cruvinel	\N
191	Bruno Rodrigues	\N
192	Fernando Honorato	\N
193	Eduardo Farias	\N
194	Danilo Ribeiro	\N
195	Rodrigo Espiuca	\N
196	Bruno Antunes	\N
197	Leonardo Aquino	\N
198	Adriana dos Reis	\N
452	Fernando Honorato	\N
453	Adriana dos Reis	\N
454	Leonardo Aquino	\N
455	Danilo Ribeiro	\N
456	Rodrigo Palma	\N
457	Márcia Bicalho	\N
458	José Roberto Carvalho	\N
459	Alexandre Coelho	\N
460	Kênia Nogueira	\N
461	Fernando Perazzoli	\N
462	Camila Ribeiro	\N
463	Heitor Pessoa	\N
464	Ministra Daniela Teixeira	\N
465	Patrícia Nunes	\N
466	Raquel Mousinho	\N
467	Lizandra Oliveira	\N
468	Ministro Teodoro Silva Santos	\N
469	Andrezza Passani	\N
470	Analice Andrade	\N
471	Ministro Reynaldo da Fonseca	\N
472	Gabriela Nunes	\N
473	Marcelo Cruvinel	\N
474	Bruno Rodrigues	\N
475	Fernando Honorato	\N
476	Adriana dos Reis	\N
477	Leonardo Aquino	\N
225	Rodrigo Palma	\N
226	Márcia Bicalho	\N
227	José Roberto Carvalho	\N
228	Alexandre Coelho	\N
229	Kênia Nogueira	\N
230	Fernando Perazzoli	\N
231	Camila Ribeiro	\N
232	Heitor Pessoa	\N
233	Ministra Daniela Teixeira	\N
234	Patrícia Nunes	\N
235	Raquel Mousinho	\N
236	Lizandra Oliveira	\N
237	Ministro Teodoro Silva Santos	\N
238	Andrezza Passani	\N
239	Analice Andrade	\N
240	Ministro Reynaldo da Fonseca	\N
241	Gabriela Nunes	\N
242	Marcelo Cruvinel	\N
243	Bruno Rodrigues	\N
244	Fernando Honorato	\N
245	Eduardo Farias	\N
246	Danilo Ribeiro	\N
247	Rodrigo Espiuca	\N
248	Bruno Antunes	\N
249	Leonardo Aquino	\N
250	Adriana dos Reis	\N
251	Rodrigo Palma	\N
252	Márcia Bicalho	\N
253	José Roberto Carvalho	\N
254	Alexandre Coelho	\N
255	Kênia Nogueira	\N
256	Fernando Perazzoli	\N
257	Camila Ribeiro	\N
258	Heitor Pessoa	\N
259	Ministra Daniela Teixeira	\N
260	Patrícia Nunes	\N
261	Raquel Mousinho	\N
262	Lizandra Oliveira	\N
263	Ministro Teodoro Silva Santos	\N
264	Andrezza Passani	\N
265	Analice Andrade	\N
266	Ministro Reynaldo da Fonseca	\N
267	Gabriela Nunes	\N
268	Marcelo Cruvinel	\N
269	Bruno Rodrigues	\N
270	Fernando Honorato	\N
271	Eduardo Farias	\N
272	Danilo Ribeiro	\N
273	Rodrigo Espiuca	\N
274	Bruno Antunes	\N
275	Leonardo Aquino	\N
276	Adriana dos Reis	\N
277	Rodrigo Palma	\N
278	Márcia Bicalho	\N
279	José Roberto Carvalho	\N
280	Alexandre Coelho	\N
281	Kênia Nogueira	\N
282	Fernando Perazzoli	\N
283	Camila Ribeiro	\N
284	Heitor Pessoa	\N
285	Ministra Daniela Teixeira	\N
286	Patrícia Nunes	\N
287	Raquel Mousinho	\N
288	Lizandra Oliveira	\N
289	Ministro Teodoro Silva Santos	\N
290	Andrezza Passani	\N
291	Analice Andrade	\N
292	Ministro Reynaldo da Fonseca	\N
293	Gabriela Nunes	\N
294	Marcelo Cruvinel	\N
295	Bruno Rodrigues	\N
296	Fernando Honorato	\N
297	Eduardo Farias	\N
298	Danilo Ribeiro	\N
299	Rodrigo Espiuca	\N
300	Bruno Antunes	\N
301	Leonardo Aquino	\N
302	Adriana dos Reis	\N
303	Rodrigo Palma	\N
304	Márcia Bicalho	\N
305	José Roberto Carvalho	\N
306	Alexandre Coelho	\N
307	Kênia Nogueira	\N
308	Fernando Perazzoli	\N
309	Camila Ribeiro	\N
310	Heitor Pessoa	\N
311	Ministra Daniela Teixeira	\N
312	Patrícia Nunes	\N
313	Raquel Mousinho	\N
314	Lizandra Oliveira	\N
315	Ministro Teodoro Silva Santos	\N
316	Andrezza Passani	\N
317	Analice Andrade	\N
318	Ministro Reynaldo da Fonseca	\N
319	Gabriela Nunes	\N
320	Marcelo Cruvinel	\N
321	Bruno Rodrigues	\N
322	Fernando Honorato	\N
323	Eduardo Farias	\N
324	Danilo Ribeiro	\N
325	Rodrigo Espiuca	\N
326	Bruno Antunes	\N
327	Leonardo Aquino	\N
328	Adriana dos Reis	\N
329	Rodrigo Palma	\N
330	Márcia Bicalho	\N
331	José Roberto Carvalho	\N
332	Alexandre Coelho	\N
333	Kênia Nogueira	\N
334	Fernando Perazzoli	\N
335	Camila Ribeiro	\N
336	Heitor Pessoa	\N
337	Ministra Daniela Teixeira	\N
338	Patrícia Nunes	\N
339	Raquel Mousinho	\N
340	Lizandra Oliveira	\N
341	Ministro Teodoro Silva Santos	\N
342	Andrezza Passani	\N
343	Analice Andrade	\N
344	Ministro Reynaldo da Fonseca	\N
345	Gabriela Nunes	\N
346	Marcelo Cruvinel	\N
347	Bruno Rodrigues	\N
348	Fernando Honorato	\N
349	Eduardo Farias	\N
350	Danilo Ribeiro	\N
351	Rodrigo Espiuca	\N
352	Bruno Antunes	\N
353	Leonardo Aquino	\N
354	Adriana dos Reis	\N
478	Danilo Ribeiro	\N
479	Rodrigo Palma	\N
480	Márcia Bicalho	\N
481	José Roberto Carvalho	\N
482	Alexandre Coelho	\N
483	Kênia Nogueira	\N
484	Fernando Perazzoli	\N
485	Camila Ribeiro	\N
486	Heitor Pessoa	\N
487	Ministra Daniela Teixeira	\N
488	Patrícia Nunes	\N
489	Raquel Mousinho	\N
490	Lizandra Oliveira	\N
491	Ministro Teodoro Silva Santos	\N
492	Andrezza Passani	\N
493	Analice Andrade	\N
494	Ministro Reynaldo da Fonseca	\N
495	Gabriela Nunes	\N
496	Marcelo Cruvinel	\N
497	Bruno Rodrigues	\N
498	Fernando Honorato	\N
499	Eduardo Farias	\N
500	Danilo Ribeiro	\N
501	Rodrigo Espiuca	\N
502	Bruno Antunes	\N
503	Leonardo Aquino	\N
504	Adriana dos Reis	\N
505	Rodrigo Palma	\N
506	Márcia Bicalho	\N
507	José Roberto Carvalho	\N
508	Alexandre Coelho	\N
509	Kênia Nogueira	\N
510	Fernando Perazzoli	\N
511	Camila Ribeiro	\N
512	Heitor Pessoa	\N
513	Ministra Daniela Teixeira	\N
514	Patrícia Nunes	\N
515	Raquel Mousinho	\N
516	Lizandra Oliveira	\N
517	Ministro Teodoro Silva Santos	\N
518	Andrezza Passani	\N
519	Analice Andrade	\N
520	Ministro Reynaldo da Fonseca	\N
521	Gabriela Nunes	\N
522	Marcelo Cruvinel	\N
523	Bruno Rodrigues	\N
524	Fernando Honorato	\N
525	Eduardo Farias	\N
526	Danilo Ribeiro	\N
527	Rodrigo Espiuca	\N
528	Bruno Antunes	\N
529	Leonardo Aquino	\N
530	Adriana dos Reis	\N
555	Rodrigo Palma	\N
556	Márcia Bicalho	\N
557	José Roberto Carvalho	\N
558	Alexandre Coelho	\N
559	Kênia Nogueira	\N
560	Fernando Perazzoli	\N
561	Camila Ribeiro	\N
562	Heitor Pessoa	\N
563	Ministra Daniela Teixeira	\N
564	Patrícia Nunes	\N
565	Raquel Mousinho	\N
566	Lizandra Oliveira	\N
567	Ministro Teodoro Silva Santos	\N
568	Andrezza Passani	\N
569	Analice Andrade	\N
570	Ministro Reynaldo da Fonseca	\N
571	Gabriela Nunes	\N
572	Marcelo Cruvinel	\N
573	Bruno Rodrigues	\N
574	Fernando Honorato	\N
575	Eduardo Farias	\N
576	Danilo Ribeiro	\N
577	Rodrigo Espiuca	\N
578	Bruno Antunes	\N
579	Leonardo Aquino	\N
580	Adriana dos Reis	\N
581	Ministro André Mendonça	\N
582	Rodrigo Palma	\N
583	Márcia Bicalho	\N
584	José Roberto Carvalho	\N
585	Alexandre Coelho	\N
586	Kênia Nogueira	\N
587	Fernando Perazzoli	\N
588	Camila Ribeiro	\N
589	Heitor Pessoa	\N
590	Ministra Daniela Teixeira	\N
591	Patrícia Nunes	\N
592	Raquel Mousinho	\N
593	Lizandra Oliveira	\N
594	Ministro Teodoro Silva Santos	\N
595	Andrezza Passani	\N
596	Analice Andrade	\N
597	Ministro Reynaldo da Fonseca	\N
598	Gabriela Nunes	\N
599	Marcelo Cruvinel	\N
600	Bruno Rodrigues	\N
601	Fernando Honorato	\N
602	Adriana dos Reis	\N
603	Leonardo Aquino	\N
604	Danilo Ribeiro	\N
605	Ministro André Mendonça	\N
606	Rodrigo Palma	\N
607	Márcia Bicalho	\N
608	José Roberto Carvalho	\N
609	Alexandre Coelho	\N
610	Kênia Nogueira	\N
611	Fernando Perazzoli	\N
612	Camila Ribeiro	\N
613	Heitor Pessoa	\N
614	Ministra Daniela Teixeira	\N
615	Patrícia Nunes	\N
616	Raquel Mousinho	\N
617	Lizandra Oliveira	\N
618	Ministro Teodoro Silva Santos	\N
619	Andrezza Passani	\N
620	Analice Andrade	\N
621	Ministro Reynaldo da Fonseca	\N
622	Gabriela Nunes	\N
623	Marcelo Cruvinel	\N
624	Bruno Rodrigues	\N
625	Fernando Honorato	\N
626	Adriana dos Reis	\N
627	Leonardo Aquino	\N
628	Danilo Ribeiro	\N
629	Ministro André Mendonça	\N
630	Rodrigo Palma	\N
631	Márcia Bicalho	\N
632	José Roberto Carvalho	\N
633	Alexandre Coelho	\N
634	Kênia Nogueira	\N
635	Fernando Perazzoli	\N
636	Camila Ribeiro	\N
637	Heitor Pessoa	\N
638	Ministra Daniela Teixeira	\N
639	Patrícia Nunes	\N
640	Raquel Mousinho	\N
641	Lizandra Oliveira	\N
642	Ministro Teodoro Silva Santos	\N
643	Andrezza Passani	\N
644	Analice Andrade	\N
645	Ministro Reynaldo da Fonseca	\N
646	Gabriela Nunes	\N
647	Marcelo Cruvinel	\N
648	Bruno Rodrigues	\N
649	Fernando Honorato	\N
650	Eduardo Farias	\N
651	Danilo Ribeiro	\N
652	Rodrigo Espiuca	\N
653	Bruno Antunes	\N
654	Leonardo Aquino	\N
655	Adriana dos Reis	\N
656	Ministro André Mendonça	\N
657	Rodrigo Palma	\N
658	Márcia Bicalho	\N
659	José Roberto Carvalho	\N
660	Alexandre Coelho	\N
661	Kênia Nogueira	\N
662	Fernando Perazzoli	\N
663	Camila Ribeiro	\N
664	Heitor Pessoa	\N
665	Ministra Daniela Teixeira	\N
666	Patrícia Nunes	\N
667	Raquel Mousinho	\N
668	Lizandra Oliveira	\N
669	Ministro Teodoro Silva Santos	\N
670	Andrezza Passani	\N
671	Analice Andrade	\N
672	Ministro Reynaldo da Fonseca	\N
673	Gabriela Nunes	\N
674	Marcelo Cruvinel	\N
675	Bruno Rodrigues	\N
676	Fernando Honorato	\N
677	Eduardo Farias	\N
678	Danilo Ribeiro	\N
679	Rodrigo Espiuca	\N
680	Bruno Antunes	\N
681	Leonardo Aquino	\N
682	Adriana dos Reis	\N
683	Ministro André Mendonça	\N
684	Rodrigo Palma	\N
685	Márcia Bicalho	\N
686	José Roberto Carvalho	\N
687	Alexandre Coelho	\N
688	Kênia Nogueira	\N
689	Fernando Perazzoli	\N
690	Camila Ribeiro	\N
691	Heitor Pessoa	\N
692	Ministra Daniela Teixeira	\N
693	Patrícia Nunes	\N
694	Raquel Mousinho	\N
695	Lizandra Oliveira	\N
696	Ministro Teodoro Silva Santos	\N
697	Andrezza Passani	\N
698	Analice Andrade	\N
699	Ministro Reynaldo da Fonseca	\N
700	Gabriela Nunes	\N
701	Marcelo Cruvinel	\N
702	Bruno Rodrigues	\N
703	Fernando Honorato	\N
704	Eduardo Farias	\N
705	Danilo Ribeiro	\N
706	Rodrigo Espiuca	\N
707	Bruno Antunes	\N
708	Leonardo Aquino	\N
709	Adriana dos Reis	\N
710	Ministro André Mendonça	\N
711	Rodrigo Palma	\N
712	Márcia Bicalho	\N
713	José Roberto Carvalho	\N
714	Alexandre Coelho	\N
715	Kênia Nogueira	\N
716	Fernando Perazzoli	\N
717	Camila Ribeiro	\N
718	Heitor Pessoa	\N
719	Ministra Daniela Teixeira	\N
720	Patrícia Nunes	\N
721	Raquel Mousinho	\N
722	Lizandra Oliveira	\N
723	Ministro Teodoro Silva Santos	\N
724	Andrezza Passani	\N
725	Analice Andrade	\N
726	Ministro Reynaldo da Fonseca	\N
727	Gabriela Nunes	\N
728	Marcelo Cruvinel	\N
729	Bruno Rodrigues	\N
730	Fernando Honorato	\N
731	Eduardo Farias	\N
732	Danilo Ribeiro	\N
733	Rodrigo Espiuca	\N
734	Bruno Antunes	\N
735	Leonardo Aquino	\N
736	Adriana dos Reis	\N
737	Ministro André Mendonça	\N
738	Rodrigo Palma	\N
739	Márcia Bicalho	\N
740	José Roberto Carvalho	\N
741	Alexandre Coelho	\N
742	Kênia Nogueira	\N
743	Fernando Perazzoli	\N
744	Camila Ribeiro	\N
745	Heitor Pessoa	\N
746	Ministra Daniela Teixeira	\N
747	Patrícia Nunes	\N
748	Raquel Mousinho	\N
749	Lizandra Oliveira	\N
750	Ministro Teodoro Silva Santos	\N
751	Andrezza Passani	\N
752	Analice Andrade	\N
753	Ministro Reynaldo da Fonseca	\N
754	Gabriela Nunes	\N
755	Marcelo Cruvinel	\N
756	Bruno Rodrigues	\N
757	Fernando Honorato	\N
758	Eduardo Farias	\N
759	Danilo Ribeiro	\N
760	Rodrigo Espiuca	\N
761	Bruno Antunes	\N
762	Leonardo Aquino	\N
763	Adriana dos Reis	\N
764	Ministro André Mendonça	\N
765	Rodrigo Palma	\N
766	Márcia Bicalho	\N
767	José Roberto Carvalho	\N
768	Alexandre Coelho	\N
769	Kênia Nogueira	\N
770	Fernando Perazzoli	\N
771	Camila Ribeiro	\N
772	Heitor Pessoa	\N
773	Ministra Daniela Teixeira	\N
774	Patrícia Nunes	\N
775	Raquel Mousinho	\N
776	Lizandra Oliveira	\N
777	Ministro Teodoro Silva Santos	\N
778	Andrezza Passani	\N
779	Analice Andrade	\N
780	Ministro Reynaldo da Fonseca	\N
781	Gabriela Nunes	\N
782	Marcelo Cruvinel	\N
783	Bruno Rodrigues	\N
784	Fernando Honorato	\N
785	Eduardo Farias	\N
786	Danilo Ribeiro	\N
787	Rodrigo Espiuca	\N
788	Bruno Antunes	\N
789	Leonardo Aquino	\N
790	Adriana dos Reis	\N
791	Ministro André Mendonça	\N
792	Rodrigo Palma	\N
793	Márcia Bicalho	\N
794	José Roberto Carvalho	\N
795	Alexandre Coelho	\N
796	Kênia Nogueira	\N
797	Fernando Perazzoli	\N
798	Camila Ribeiro	\N
799	Heitor Pessoa	\N
800	Ministra Daniela Teixeira	\N
801	Patrícia Nunes	\N
802	Raquel Mousinho	\N
803	Lizandra Oliveira	\N
804	Ministro Teodoro Silva Santos	\N
805	Andrezza Passani	\N
806	Analice Andrade	\N
807	Ministro Reynaldo da Fonseca	\N
808	Gabriela Nunes	\N
809	Marcelo Cruvinel	\N
810	Bruno Rodrigues	\N
811	Fernando Honorato	\N
812	Eduardo Farias	\N
813	Danilo Ribeiro	\N
814	Rodrigo Espiuca	\N
815	Bruno Antunes	\N
816	Leonardo Aquino	\N
817	Adriana dos Reis	\N
818	Ministro André Mendonça	\N
819	Rodrigo Palma	\N
820	Márcia Bicalho	\N
821	José Roberto Carvalho	\N
822	Alexandre Coelho	\N
823	Kênia Nogueira	\N
824	Fernando Perazzoli	\N
825	Camila Ribeiro	\N
826	Heitor Pessoa	\N
827	Ministra Daniela Teixeira	\N
828	Patrícia Nunes	\N
829	Raquel Mousinho	\N
830	Lizandra Oliveira	\N
831	Ministro Teodoro Silva Santos	\N
832	Andrezza Passani	\N
833	Analice Andrade	\N
834	Ministro Reynaldo da Fonseca	\N
835	Gabriela Nunes	\N
836	Marcelo Cruvinel	\N
837	Bruno Rodrigues	\N
838	Fernando Honorato	\N
839	Eduardo Farias	\N
840	Danilo Ribeiro	\N
841	Rodrigo Espiuca	\N
842	Bruno Antunes	\N
843	Leonardo Aquino	\N
844	Adriana dos Reis	\N
845	Ministro André Mendonça	\N
846	Rodrigo Palma	\N
847	Márcia Bicalho	\N
848	José Roberto Carvalho	\N
849	Alexandre Coelho	\N
850	Kênia Nogueira	\N
851	Fernando Perazzoli	\N
852	Camila Ribeiro	\N
853	Heitor Pessoa	\N
854	Ministra Daniela Teixeira	\N
855	Patrícia Nunes	\N
856	Raquel Mousinho	\N
857	Lizandra Oliveira	\N
858	Ministro Teodoro Silva Santos	\N
859	Andrezza Passani	\N
860	Analice Andrade	\N
861	Ministro Reynaldo da Fonseca	\N
862	Gabriela Nunes	\N
863	Marcelo Cruvinel	\N
864	Bruno Rodrigues	\N
865	Fernando Honorato	\N
866	Eduardo Farias	\N
867	Danilo Ribeiro	\N
868	Rodrigo Espiuca	\N
869	Bruno Antunes	\N
870	Leonardo Aquino	\N
871	Adriana dos Reis	\N
872	Ministro André Mendonça	\N
873	Rodrigo Palma	\N
874	Márcia Bicalho	\N
875	José Roberto Carvalho	\N
876	Alexandre Coelho	\N
877	Kênia Nogueira	\N
878	Fernando Perazzoli	\N
879	Camila Ribeiro	\N
880	Heitor Pessoa	\N
881	Ministra Daniela Teixeira	\N
882	Patrícia Nunes	\N
883	Raquel Mousinho	\N
884	Lizandra Oliveira	\N
885	Ministro Teodoro Silva Santos	\N
886	Andrezza Passani	\N
887	Analice Andrade	\N
888	Ministro Reynaldo da Fonseca	\N
889	Gabriela Nunes	\N
890	Marcelo Cruvinel	\N
891	Bruno Rodrigues	\N
892	Fernando Honorato	\N
893	Eduardo Farias	\N
894	Danilo Ribeiro	\N
895	Rodrigo Espiuca	\N
896	Bruno Antunes	\N
897	Leonardo Aquino	\N
898	Adriana dos Reis	\N
899	Ministro André Mendonça	\N
\.


--
-- Data for Name: turmas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.turmas (id, nome, semestre_ref, curso_id, turno_id, unidade) FROM stdin;
1	Turma 1º	1	1	1	Águas Claras
3	Turma 2	1°	2	9	Águas Claras
4	Turma 12	4°	1	8	Asa Sul
5	1º Período - Biomedicina	1º	4	1	Águas Claras
6	3º Período - Biomedicina	3º	4	1	Águas Claras
7	1º Período - Biomedicina (Noite)	1º	4	8	Águas Claras
8	3º Período - Biomedicina (Noite)	3º	4	8	Águas Claras
9	5º Período - Biomedicina (Noite)	5º	4	8	Águas Claras
102	2º/3º Semestre - Enfermagem	2º/3º	8	1	Águas Claras
103	4º/5º Semestre - Enfermagem	4º/5º	8	1	Águas Claras
104	6º/7º/8º Semestre - Enfermagem	6º-8º	8	1	Águas Claras
105	9º Semestre - Enfermagem	9º	8	1	Águas Claras
106	10º Semestre - Enfermagem	10º	8	1	Águas Claras
107	2º/3º Semestre - Enfermagem (Noite)	2º/3º	8	8	Águas Claras
108	4º/5º Semestre - Enfermagem (Noite)	4º/5º	8	8	Águas Claras
109	6º/7º Semestre - Enfermagem (Noite)	6º/7º	8	8	Águas Claras
110	2º/3º Semestre - Enfermagem (AS)	2º/3º	8	1	Asa Sul
111	4º-7º Semestre - Enfermagem (AS)	4º-7º	8	1	Asa Sul
112	9º Semestre - Enfermagem (AS)	9º	8	1	Asa Sul
48	1º Período - Arquitetura	1º	6	1	Águas Claras
49	2º/3º Período - Arquitetura	2º/3º	6	1	Águas Claras
50	4º/5º Período - Arquitetura	4º/5º	6	1	Águas Claras
51	6º/7º Período - Arquitetura	6º/7º	6	1	Águas Claras
52	8º Período - Arquitetura	8º	6	1	Águas Claras
53	9º Período - Arquitetura	9º	6	1	Águas Claras
54	1º Período - Arquitetura (Noite)	1º	6	8	Águas Claras
55	4º/5º Período - Arquitetura (Noite)	4º/5º	6	8	Águas Claras
56	9º Período - Arquitetura (Noite)	9º	6	8	Águas Claras
57	10º Período - Arquitetura (Noite)	10º	6	8	Águas Claras
653	1º Semestre - Direito (AS)	1º	3	1	Asa Sul
654	2º/3º Semestre - Direito (AS)	2º/3º	3	1	Asa Sul
655	4º/5º Semestre - Direito (AS)	4º/5º	3	1	Asa Sul
656	6º/7º Semestre - Direito (AS)	6º/7º	3	1	Asa Sul
657	8º/9º Semestre - Direito (AS)	8º/9º	3	1	Asa Sul
658	1º Semestre - Direito (AS Noite)	1º	3	8	Asa Sul
659	2º/3º Semestre - Direito (AS Noite)	2º/3º	3	8	Asa Sul
513	1º/2º Semestre - Direito	1º/2º	3	1	Águas Claras
514	3º/4º Semestre - Direito	3º/4º	3	1	Águas Claras
515	5º/6º Semestre - Direito	5º/6º	3	1	Águas Claras
516	7º/8º Semestre - Direito	7º/8º	3	1	Águas Claras
517	9º/10º Semestre - Direito	9º/10º	3	1	Águas Claras
518	1º Semestre - Direito (Noite)	1º	3	8	Águas Claras
519	2º/3º Semestre - Direito (Noite)	2º/3º	3	8	Águas Claras
520	4º/5º Semestre - Direito (Noite)	4º/5º	3	8	Águas Claras
521	6º/7º Semestre - Direito (Noite)	6º/7º	3	8	Águas Claras
522	8º/9º Semestre - Direito (Noite)	8º/9º	3	8	Águas Claras
523	10º Semestre - Direito (Noite)	10º	3	8	Águas Claras
660	4º/5º Semestre - Direito (AS Noite)	4º/5º	3	8	Asa Sul
661	6º/7º Semestre - Direito (AS Noite)	6º/7º	3	8	Asa Sul
662	10º Semestre - Direito (AS Noite)	10º	3	8	Asa Sul
\.


--
-- Data for Name: turnos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.turnos (id, nome, slug, icone, tema_class, ordem) FROM stdin;
1	Matutino	matutino	fa-sun	matutino-theme	2
8	Noturno	noturno	fa-moon	noturno-theme	\N
7	Vespertino	vespertino	fa-cloud-sun	\N	\N
9	Integral	integral	fa-clock	\N	\N
\.


--
-- Data for Name: usuarios; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.usuarios (id, nome, email, senha, tipo, token_acesso, curso_responsavel_id, unidade_responsavel) FROM stdin;
1	Diretor Geral	admin@escola.com	x	admin	master123	\N	\N
2	Prof. Michel	michel@escola.com	x	coordenador	michelTI	1	\N
3	Assistente NAP	nap@escola.com	x	nap	nap123	\N	\N
4	NAP Águas Claras	napac@escola.com	x	nap	nap_ac	\N	Águas Claras
5	NAP Asa Sul	napasa@escola.com	x	nap	nap_asa	\N	Asa Sul
\.


--
-- Name: cursos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cursos_id_seq', 8, true);


--
-- Name: disciplinas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.disciplinas_id_seq', 2319, true);


--
-- Name: grade_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grade_id_seq', 5754, true);


--
-- Name: professores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.professores_id_seq', 899, true);


--
-- Name: turmas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.turmas_id_seq', 662, true);


--
-- Name: turnos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.turnos_id_seq', 9, true);


--
-- Name: usuarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.usuarios_id_seq', 5, true);


--
-- Name: cursos cursos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cursos
    ADD CONSTRAINT cursos_pkey PRIMARY KEY (id);


--
-- Name: disciplinas disciplinas_nome_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.disciplinas
    ADD CONSTRAINT disciplinas_nome_unique UNIQUE (nome);


--
-- Name: disciplinas disciplinas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.disciplinas
    ADD CONSTRAINT disciplinas_pkey PRIMARY KEY (id);


--
-- Name: grade grade_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade
    ADD CONSTRAINT grade_pkey PRIMARY KEY (id);


--
-- Name: professores professores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.professores
    ADD CONSTRAINT professores_pkey PRIMARY KEY (id);


--
-- Name: turmas turmas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turmas
    ADD CONSTRAINT turmas_pkey PRIMARY KEY (id);


--
-- Name: turnos turnos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turnos
    ADD CONSTRAINT turnos_pkey PRIMARY KEY (id);


--
-- Name: turnos turnos_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turnos
    ADD CONSTRAINT turnos_slug_key UNIQUE (slug);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: grade grade_disciplina_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade
    ADD CONSTRAINT grade_disciplina_id_fkey FOREIGN KEY (disciplina_id) REFERENCES public.disciplinas(id);


--
-- Name: grade grade_professor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade
    ADD CONSTRAINT grade_professor_id_fkey FOREIGN KEY (professor_id) REFERENCES public.professores(id);


--
-- Name: grade grade_turma_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade
    ADD CONSTRAINT grade_turma_id_fkey FOREIGN KEY (turma_id) REFERENCES public.turmas(id);


--
-- Name: turmas turmas_curso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turmas
    ADD CONSTRAINT turmas_curso_id_fkey FOREIGN KEY (curso_id) REFERENCES public.cursos(id);


--
-- Name: turmas turmas_turno_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turmas
    ADD CONSTRAINT turmas_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES public.turnos(id);


--
-- Name: usuarios usuarios_curso_responsavel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_curso_responsavel_id_fkey FOREIGN KEY (curso_responsavel_id) REFERENCES public.cursos(id);


--
-- PostgreSQL database dump complete
--

\unrestrict EQfPGbPkyYyih9PAHXsAzVcDPaNqTvqbZdiyIOMhLvPh4f2yhdajNHebjn3vhJM

