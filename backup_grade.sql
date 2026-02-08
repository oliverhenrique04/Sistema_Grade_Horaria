--
-- PostgreSQL database dump
--

\restrict bmGlYQD1tJ2t4hkaeO3j1e0qTSR4pcwCKxum8xEs0EY6pKdaoIEUXag9CFLmVHK

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
2	Administração	8	Erica Harbs
3	Direito	8	Miria e Cleyber
4	Biomedicina	8	Carla Danielle Dias Costa
6	Arquitetura e Urbanismo	10	Coordenação Arquitetura
8	Enfermagem	10	Coordenação Enfermagem
10	Computação	8	Prof. Michel Junio
\.


--
-- Data for Name: disciplinas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.disciplinas (id, nome, carga_horaria) FROM stdin;
1	Lógica Computacional	\N
2	Engenharia de Software	\N
2320	Empreendedorismo em TI	\N
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
2321	Redes de Computadores	\N
2322	Programação Concorrente e Distribuída	\N
2323	Fundamentos de Sistemas de Informação	\N
2324	Programação para Web	\N
2325	Projeto Integrador Programação Estruturada	\N
2326	Gerência de Projetos	\N
2327	Programação Mobile	\N
2328	Estrutura de Dados	\N
2329	Matemática Computacional	\N
2330	Engenharia de Requisitos	\N
2331	Interação Humano-Computador	\N
2332	Banco de Dados I	\N
2334	Projeto Integrador Programação Paralela	\N
2335	Projeto de Sistemas de Informação I	\N
2337	Mineração de Dados	\N
2338	Projeto Integrador Modelagem de Software	\N
2339	Algoritmos	\N
2340	Projeto Integrador DEVOPS	\N
2341	Organização e Arquitetura de Computadores	\N
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
2369	PI Modelagem de Software	\N
2371	Org. e Arq. de Computadores	\N
2375	PI Prog. Estruturada	\N
2377	PI Computação Paralela	\N
2379	Prog. Mobile	\N
2380	Prog. Concorrente e Distribuída	\N
2382	Projeto de S.I.	\N
2383	Estágio Sup. I	\N
2385	PI DEVOPS	\N
2390	PI Programação Estruturada	\N
2391	Programação Web	\N
2462	Redes de Computadores (SI)	\N
2463	Programação Mobile (ADS)	\N
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
2464	Dia Livre	\N
2465	Dia Livre (SI)	\N
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
6066	732	SEG	2462	921	fa-calendar	\N	f	f	Lab 02
6074	731	SEX	2331	901	fa-calendar	\N	f	f	Lab 01
5631	653	QUA	404	175	fa-calendar	\N	f	f	\N
3959	520	SEX	428	182	fa-calendar	\N	f	f	\N
5653	655	QUA	430	183	fa-calendar	\N	f	f	\N
5654	655	QUA	430	183	fa-calendar	\N	f	f	\N
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
5655	655	QUA	430	183	fa-calendar	\N	f	f	\N
5722	660	QUI	430	183	fa-calendar	\N	f	f	\N
5723	660	QUI	430	183	fa-calendar	\N	f	f	\N
5724	660	QUI	430	183	fa-calendar	\N	f	f	\N
3957	520	QUA	430	183	fa-calendar	\N	f	f	\N
3950	519	TER	20	184	fa-calendar	\N	f	f	\N
3921	515	QUA	436	184	fa-calendar	\N	f	f	\N
5659	655	SEX	432	184	fa-calendar	\N	f	f	\N
5660	655	SEX	432	184	fa-calendar	\N	f	f	\N
5661	655	SEX	432	184	fa-calendar	\N	f	f	\N
5713	660	SEG	432	184	fa-calendar	\N	f	f	\N
5714	660	SEG	432	184	fa-calendar	\N	f	f	\N
5715	660	SEG	432	184	fa-calendar	\N	f	f	\N
3958	520	QUI	432	184	fa-calendar	\N	f	f	\N
3949	519	TER	417	184	fa-calendar	\N	f	f	\N
3929	516	QUI	453	186	fa-calendar	\N	f	f	\N
3928	516	QUI	450	186	fa-calendar	\N	f	f	\N
5673	656	SEX	446	186	fa-calendar	\N	f	f	\N
5674	656	SEX	446	186	fa-calendar	\N	f	f	\N
5732	661	TER	446	186	fa-calendar	\N	f	f	\N
5733	661	TER	446	186	fa-calendar	\N	f	f	\N
5734	661	TER	446	186	fa-calendar	\N	f	f	\N
5663	656	SEG	441	186	fa-calendar	\N	f	f	\N
5664	656	SEG	441	186	fa-calendar	\N	f	f	\N
5665	656	SEG	441	186	fa-calendar	\N	f	f	\N
5729	661	SEG	441	186	fa-calendar	\N	f	f	\N
1067	102	QUI	206	83	fa-calendar	\N	f	f	\N
1068	102	QUI	206	83	fa-calendar	\N	f	f	\N
23	7	TER	8	\N	fa-calendar	\N	f	f	EAD
474	48	SEG	58	29	fa-calendar	\N	f	f	\N
481	48	TER	56	29	fa-calendar	\N	f	f	\N
1069	102	QUI	206	83	fa-calendar	\N	f	f	\N
1070	102	QUI	206	83	fa-calendar	\N	f	f	\N
480	48	TER	56	29	fa-calendar	\N	f	f	\N
5730	661	SEG	441	186	fa-calendar	\N	f	f	\N
85	5	SEX	8	\N	fa-calendar	\N	f	f	EAD
86	5	SEX	8	\N	fa-calendar	\N	f	f	EAD
87	5	SEX	11	7	fa-calendar	\N	f	f	
5731	661	SEG	441	186	fa-calendar	\N	f	f	\N
5670	656	QUI	444	187	fa-calendar	\N	f	f	\N
5671	656	QUI	444	187	fa-calendar	\N	f	f	\N
3962	521	SEG	441	187	fa-calendar	\N	f	f	\N
5725	660	SEX	431	187	fa-calendar	\N	f	f	\N
5726	660	SEX	431	187	fa-calendar	\N	f	f	\N
5727	660	SEX	431	187	fa-calendar	\N	f	f	\N
5672	656	QUI	445	188	fa-calendar	\N	f	f	\N
1072	102	SEX	230	8	fa-calendar	\N	f	f	\N
1073	102	SEX	230	8	fa-calendar	\N	f	f	\N
5737	661	QUA	445	188	fa-calendar	\N	f	f	\N
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
3925	516	SEG	448	190	fa-calendar	\N	f	f	\N
3947	518	SEX	404	192	fa-calendar	\N	f	f	\N
3926	516	TER	449	193	fa-calendar	\N	f	f	\N
73	5	SEG	4	4	fa-calendar	\N	f	f	\N
74	5	SEG	4	4	fa-calendar	\N	f	f	\N
76	5	TER	5	5	fa-calendar	\N	f	f	\N
77	5	TER	5	5	fa-calendar	\N	f	f	\N
80	5	QUA	6	6	fa-calendar	\N	f	f	\N
81	5	QUA	6	6	fa-calendar	\N	f	f	\N
83	5	QUI	7	4	fa-calendar	\N	f	f	\N
84	5	QUI	7	4	fa-calendar	\N	f	f	\N
3923	515	SEX	438	193	fa-calendar	\N	f	f	\N
3956	520	TER	427	193	fa-calendar	\N	f	f	\N
3952	519	QUI	413	193	fa-calendar	\N	f	f	\N
3965	521	QUA	445	194	fa-calendar	\N	f	f	\N
3964	521	QUA	444	194	fa-calendar	\N	f	f	\N
3920	515	TER	439	194	fa-calendar	\N	f	f	\N
3919	515	TER	435	194	fa-calendar	\N	f	f	\N
3922	515	QUI	437	195	fa-calendar	\N	f	f	\N
5741	661	SEX	444	197	fa-calendar	\N	f	f	\N
5742	661	SEX	444	197	fa-calendar	\N	f	f	\N
5743	661	SEX	444	197	fa-calendar	\N	f	f	\N
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
6067	732	QUA	2463	903	fa-calendar	\N	f	f	Lab 02
932	\N	SEG	215	83	fa-calendar	\N	f	f	\N
933	\N	SEG	215	83	fa-calendar	\N	f	f	\N
935	\N	TER	216	88	fa-calendar	\N	f	f	\N
936	\N	TER	216	88	fa-calendar	\N	f	f	\N
937	\N	QUA	242	87	fa-calendar	\N	f	f	\N
938	\N	QUA	242	87	fa-calendar	\N	f	f	\N
939	\N	QUI	244	88	fa-calendar	\N	f	f	\N
940	\N	QUI	244	88	fa-calendar	\N	f	f	\N
941	\N	SEX	246	89	fa-calendar	\N	f	f	\N
6068	732	QUI	2334	903	fa-calendar	\N	f	f	Skill Lab
6076	725	QUI	2465	975	fa-calendar	\N	f	f	
6077	724	QUI	2465	975	fa-calendar	\N	f	f	
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
5626	653	SEG	402	173	fa-calendar	\N	f	f	\N
5627	653	SEG	402	173	fa-calendar	\N	f	f	\N
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
5628	653	TER	403	174	fa-calendar	\N	f	f	\N
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
5629	653	TER	403	174	fa-calendar	\N	f	f	\N
512	53	QUA	80	35	fa-calendar	\N	f	f	\N
473	57	SEX	83	35	fa-calendar	\N	f	f	\N
472	57	SEX	83	35	fa-calendar	\N	f	f	\N
6069	732	SEX	2331	901	fa-calendar	\N	f	f	Lab 01
6078	731	SEG	2327	926	fa-calendar	\N	f	f	Skill Lab
6079	731	QUA	2322	903	fa-calendar	\N	f	f	Lab 02
5988	721	QUI	2339	2	fa-calendar	\N	f	f	Skill Lab
5989	722	QUI	2339	2	fa-calendar	\N	f	f	Skill Lab
5990	721	SEG	1	901	fa-calendar	\N	f	f	SALA
5991	722	SEG	1	901	fa-calendar	\N	f	f	SALA
5992	721	SEX	2341	901	fa-calendar	\N	f	f	SALA
5993	722	SEX	2341	901	fa-calendar	\N	f	f	SALA
5994	721	QUI	2339	904	fa-calendar	\N	f	f	Skill Lab
5639	654	SEG	20	581	fa-calendar	\N	f	f	\N
5688	658	TER	402	173	fa-calendar	\N	f	f	\N
5689	658	TER	402	173	fa-calendar	\N	f	f	\N
5690	658	TER	402	173	fa-calendar	\N	f	f	\N
5693	658	QUI	403	174	fa-calendar	\N	f	f	\N
5995	722	QUI	2339	904	fa-calendar	\N	f	f	Skill Lab
5996	721	QUA	2338	907	fa-calendar	\N	f	f	Lab 01
5694	658	QUI	403	174	fa-calendar	\N	f	f	\N
5695	658	QUI	403	174	fa-calendar	\N	f	f	\N
5634	653	SEX	406	175	fa-calendar	\N	f	f	\N
5635	653	SEX	406	175	fa-calendar	\N	f	f	\N
5696	658	SEX	406	175	fa-calendar	\N	f	f	\N
5697	658	SEX	406	175	fa-calendar	\N	f	f	\N
5630	653	QUA	404	175	fa-calendar	\N	f	f	\N
5632	653	QUI	405	176	fa-calendar	\N	f	f	\N
5633	653	QUI	405	176	fa-calendar	\N	f	f	\N
5686	658	SEG	405	176	fa-calendar	\N	f	f	\N
5687	658	SEG	405	176	fa-calendar	\N	f	f	\N
5637	654	SEG	413	177	fa-calendar	\N	f	f	\N
5638	654	SEG	413	177	fa-calendar	\N	f	f	\N
5997	722	QUA	2338	907	fa-calendar	\N	f	f	Lab 01
5699	659	SEG	413	177	fa-calendar	\N	f	f	\N
5700	659	SEG	413	177	fa-calendar	\N	f	f	\N
5640	654	TER	414	178	fa-calendar	\N	f	f	\N
5641	654	TER	414	178	fa-calendar	\N	f	f	\N
5702	659	TER	414	178	fa-calendar	\N	f	f	\N
5703	659	TER	414	178	fa-calendar	\N	f	f	\N
5704	659	TER	414	178	fa-calendar	\N	f	f	\N
5718	660	TER	217	182	fa-calendar	\N	f	f	\N
5658	655	QUI	217	185	fa-calendar	\N	f	f	\N
5708	659	QUI	416	187	fa-calendar	\N	f	f	\N
5709	659	QUI	416	187	fa-calendar	\N	f	f	\N
5710	659	QUI	416	187	fa-calendar	\N	f	f	\N
3899	513	SEG	408	193	fa-calendar	\N	f	f	\N
5691	658	QUA	404	198	fa-calendar	\N	f	f	\N
5692	658	QUA	404	198	fa-calendar	\N	f	f	\N
5701	659	SEG	20	581	fa-calendar	\N	f	f	\N
5998	721	TER	2	908	fa-calendar	\N	f	f	Skill Lab
5999	722	TER	2	908	fa-calendar	\N	f	f	Skill Lab
6000	723	TER	2328	2	fa-calendar	\N	f	f	Lab 01 + Lab 02
6001	723	QUA	2321	901	fa-calendar	\N	f	f	SALA
6002	723	TER	2328	904	fa-calendar	\N	f	f	Lab 01 + Lab 02
6003	723	SEX	2332	907	fa-calendar	\N	f	f	Lab 02
6004	723	QUI	2325	908	fa-calendar	\N	f	f	SALA
6005	723	SEG	2330	908	fa-calendar	\N	f	f	Lab 01
6007	725	SEG	2334	2	fa-calendar	\N	f	f	Lab 02
6008	724	TER	2331	900	fa-calendar	\N	f	f	SALA
6009	725	TER	2331	900	fa-calendar	\N	f	f	SALA
6010	724	QUI	2327	903	fa-calendar	\N	f	f	Lab 01
6011	725	QUI	2327	903	fa-calendar	\N	f	f	Lab 01
6012	724	SEX	2391	903	fa-calendar	\N	f	f	Lab 01
3905	513	QUA	410	178	fa-calendar	\N	f	f	\N
3906	513	QUA	410	178	fa-calendar	\N	f	f	\N
3907	513	QUA	410	178	fa-calendar	\N	f	f	\N
5642	654	QUA	416	179	fa-calendar	\N	f	f	\N
5643	654	QUA	416	179	fa-calendar	\N	f	f	\N
5644	654	QUI	417	180	fa-calendar	\N	f	f	\N
5645	654	QUI	417	180	fa-calendar	\N	f	f	\N
5705	659	QUA	417	180	fa-calendar	\N	f	f	\N
5706	659	QUA	417	180	fa-calendar	\N	f	f	\N
5707	659	QUA	417	180	fa-calendar	\N	f	f	\N
5648	655	SEG	427	181	fa-calendar	\N	f	f	\N
5649	655	SEG	427	181	fa-calendar	\N	f	f	\N
5650	655	SEG	427	181	fa-calendar	\N	f	f	\N
5651	655	TER	428	182	fa-calendar	\N	f	f	\N
5652	655	TER	428	182	fa-calendar	\N	f	f	\N
5716	660	TER	428	182	fa-calendar	\N	f	f	\N
5717	660	TER	428	182	fa-calendar	\N	f	f	\N
3902	513	TER	409	184	fa-calendar	\N	f	f	\N
3903	513	TER	409	184	fa-calendar	\N	f	f	\N
3904	513	TER	409	184	fa-calendar	\N	f	f	\N
3915	514	QUI	425	190	fa-calendar	\N	f	f	\N
3914	514	QUI	423	190	fa-calendar	\N	f	f	\N
5719	660	QUA	427	193	fa-calendar	\N	f	f	\N
5720	660	QUA	427	193	fa-calendar	\N	f	f	\N
5721	660	QUA	427	193	fa-calendar	\N	f	f	\N
3913	514	QUA	422	193	fa-calendar	\N	f	f	\N
3900	513	SEG	408	193	fa-calendar	\N	f	f	\N
3901	513	SEG	408	193	fa-calendar	\N	f	f	\N
3912	514	TER	421	195	fa-calendar	\N	f	f	\N
3916	514	SEX	424	196	fa-calendar	\N	f	f	\N
3911	514	SEG	420	197	fa-calendar	\N	f	f	\N
6071	731	SEG	2462	901	fa-calendar	\N	f	f	Lab 02
6080	732	SEG	2327	926	fa-calendar	\N	f	f	Skill Lab
5752	662	QUI	9	\N	fa-calendar	\N	f	f	EAD
5636	653	SEX	407	\N	fa-calendar	\N	f	f	EAD
5754	662	QUI	407	\N	fa-calendar	\N	f	f	EAD
5698	658	SEX	407	\N	fa-calendar	\N	f	f	EAD
5646	654	SEX	418	\N	fa-calendar	\N	f	f	EAD
5711	659	SEX	418	\N	fa-calendar	\N	f	f	EAD
5712	659	SEX	419	\N	fa-calendar	\N	f	f	EAD
5647	654	SEX	419	\N	fa-calendar	\N	f	f	EAD
6081	732	QUA	2322	903	fa-calendar	\N	f	f	Lab 02
5746	662	TER	456	173	fa-calendar	\N	f	f	\N
5747	662	TER	456	173	fa-calendar	\N	f	f	\N
3927	516	QUA	452	173	fa-calendar	\N	f	f	\N
3942	518	SEG	402	173	fa-calendar	\N	f	f	\N
3943	518	TER	403	174	fa-calendar	\N	f	f	\N
3944	518	QUA	406	175	fa-calendar	\N	f	f	\N
3946	518	QUI	405	176	fa-calendar	\N	f	f	\N
6013	725	SEX	2391	903	fa-calendar	\N	f	f	Lab 01
6014	724	SEG	2334	904	fa-calendar	\N	f	f	Lab 02
6015	725	SEG	2334	904	fa-calendar	\N	f	f	Lab 02
5728	660	SEX	433	\N	fa-calendar	\N	f	f	EAD
5662	655	SEX	433	\N	fa-calendar	\N	f	f	EAD
6016	724	QUA	2322	908	fa-calendar	\N	f	f	Lab 02
6017	725	QUA	2322	908	fa-calendar	\N	f	f	Lab 02
6019	725	TER	2331	925	fa-calendar	\N	f	f	SALA
6021	725	TER	2331	964	fa-calendar	\N	f	f	SALA
6022	726	QUA	2337	2	fa-calendar	\N	f	f	Skill Lab
6023	727	QUA	2337	2	fa-calendar	\N	f	f	Skill Lab
6024	726	SEX	2340	2	fa-calendar	\N	f	f	Skill Lab
6025	727	SEX	2340	2	fa-calendar	\N	f	f	Skill Lab
6026	726	QUI	2327	903	fa-calendar	\N	f	f	Lab 01
6027	727	QUI	2327	903	fa-calendar	\N	f	f	Lab 01
6028	726	QUA	2337	904	fa-calendar	\N	f	f	Skill Lab
6029	727	QUA	2337	904	fa-calendar	\N	f	f	Skill Lab
6030	726	SEX	2340	904	fa-calendar	\N	f	f	Skill Lab
6031	727	SEX	2340	904	fa-calendar	\N	f	f	Skill Lab
6032	726	SEG	2335	909	fa-calendar	\N	f	f	Skill Lab
6033	727	SEG	2335	909	fa-calendar	\N	f	f	Skill Lab
6034	728	SEG	2320	900	fa-calendar	\N	f	f	SALA
6035	733	SEG	2320	900	fa-calendar	\N	f	f	SALA
6036	728	TER	2323	901	fa-calendar	\N	f	f	Lab 01 + Lab 02
6037	733	TER	2323	901	fa-calendar	\N	f	f	Lab 01 + Lab 02
6040	728	QUA	2326	905	fa-calendar	\N	f	f	Skill Lab
6041	733	QUA	2326	905	fa-calendar	\N	f	f	Skill Lab
6042	728	QUI	2329	906	fa-calendar	\N	f	f	SALA
6043	733	QUI	2329	906	fa-calendar	\N	f	f	SALA
6044	729	SEG	2321	901	fa-calendar	\N	f	f	Lab 02
6045	730	SEG	2321	901	fa-calendar	\N	f	f	Lab 02
5675	656	SEX	447	\N	fa-calendar	\N	f	f	EAD
5744	661	SEX	447	\N	fa-calendar	\N	f	f	EAD
6050	731	TER	2324	903	fa-calendar	\N	f	f	Skill Lab
3932	516	SEX	454	\N	fa-calendar	\N	f	f	\N
6051	732	TER	2324	903	fa-calendar	\N	f	f	Skill Lab
3948	519	SEG	414	178	fa-calendar	\N	f	f	\N
6056	729	TER	2325	2	fa-calendar	\N	f	f	SALA
6057	730	TER	2325	2	fa-calendar	\N	f	f	SALA
3963	521	TER	446	179	fa-calendar	\N	f	f	\N
5656	655	QUI	431	179	fa-calendar	\N	f	f	\N
5657	655	QUI	431	179	fa-calendar	\N	f	f	\N
3955	520	SEG	431	179	fa-calendar	\N	f	f	\N
3951	519	QUA	416	179	fa-calendar	\N	f	f	\N
5668	656	QUA	443	180	fa-calendar	\N	f	f	\N
5669	656	QUA	443	180	fa-calendar	\N	f	f	\N
5738	661	QUI	443	180	fa-calendar	\N	f	f	\N
5739	661	QUI	443	180	fa-calendar	\N	f	f	\N
5740	661	QUI	443	180	fa-calendar	\N	f	f	\N
3918	515	SEG	434	180	fa-calendar	\N	f	f	\N
3960	520	SEX	217	182	fa-calendar	\N	f	f	\N
5666	656	TER	442	182	fa-calendar	\N	f	f	\N
5667	656	TER	442	182	fa-calendar	\N	f	f	\N
5735	661	QUA	442	182	fa-calendar	\N	f	f	\N
5736	661	QUA	442	182	fa-calendar	\N	f	f	\N
3909	513	SEX	406	\N	fa-calendar	\N	f	f	EAD
3945	518	QUA	407	\N	fa-calendar	\N	f	f	EAD
3980	523	SEX	407	\N	fa-calendar	\N	f	f	EAD
3910	513	SEX	411	\N	fa-calendar	\N	f	f	EAD
3954	519	SEX	418	\N	fa-calendar	\N	f	f	EAD
3953	519	SEX	419	\N	fa-calendar	\N	f	f	EAD
3917	514	SEX	426	\N	fa-calendar	\N	f	f	EAD
3961	520	SEX	433	\N	fa-calendar	\N	f	f	EAD
3924	515	SEX	440	\N	fa-calendar	\N	f	f	EAD
6073	731	QUI	2334	903	fa-calendar	\N	f	f	Skill Lab
6058	729	QUA	2328	902	fa-calendar	\N	f	f	Lab 01
3968	521	SEX	447	\N	fa-calendar	\N	f	f	EAD
3930	516	SEX	451	\N	fa-calendar	\N	f	f	EAD
3931	516	SEX	455	\N	fa-calendar	\N	f	f	EAD
6059	730	QUA	2328	902	fa-calendar	\N	f	f	Lab 01
6060	729	TER	2325	904	fa-calendar	\N	f	f	SALA
3977	523	SEX	458	\N	fa-calendar	\N	f	f	EAD
5751	662	QUI	458	\N	fa-calendar	\N	f	f	EAD
5745	662	TER	456	173	fa-calendar	\N	f	f	\N
3978	523	SEX	9	\N	fa-calendar	\N	f	f	EAD
75	5	SEG	9	\N	fa-calendar	\N	f	f	EAD
28	7	SEX	9	\N	fa-calendar	\N	f	f	EAD
82	5	QUA	10	\N	fa-calendar	\N	f	f	EAD
29	7	SEX	10	\N	fa-calendar	\N	f	f	EAD
3908	513	SEX	10	\N	fa-calendar	\N	f	f	EAD
3975	523	SEG	456	173	fa-calendar	\N	f	f	\N
5748	662	QUA	457	176	fa-calendar	\N	f	f	\N
5749	662	QUA	457	176	fa-calendar	\N	f	f	\N
5750	662	QUA	457	176	fa-calendar	\N	f	f	\N
3976	523	TER	457	176	fa-calendar	\N	f	f	\N
3967	521	SEX	443	180	fa-calendar	\N	f	f	\N
3966	521	QUI	442	182	fa-calendar	\N	f	f	\N
5679	657	SEG	466	189	fa-calendar	\N	f	f	\N
3970	522	SEG	466	189	fa-calendar	\N	f	f	\N
5676	657	SEG	461	189	fa-calendar	\N	f	f	\N
5677	657	SEG	461	189	fa-calendar	\N	f	f	\N
5678	657	SEG	461	189	fa-calendar	\N	f	f	\N
3969	522	SEG	461	189	fa-calendar	\N	f	f	\N
5680	657	QUA	462	190	fa-calendar	\N	f	f	\N
5681	657	QUA	462	190	fa-calendar	\N	f	f	\N
5682	657	QUA	462	190	fa-calendar	\N	f	f	\N
3979	523	SEX	460	\N	fa-calendar	\N	f	f	EAD
5753	662	QUI	460	\N	fa-calendar	\N	f	f	EAD
6061	730	TER	2325	904	fa-calendar	\N	f	f	SALA
6062	729	QUI	2330	905	fa-calendar	\N	f	f	Lab 01
3974	522	SEX	463	\N	fa-calendar	\N	f	f	EAD
5683	657	SEX	463	\N	fa-calendar	\N	f	f	EAD
3972	522	SEX	464	\N	fa-calendar	\N	f	f	\N
5684	657	SEX	464	\N	fa-calendar	\N	f	f	\N
3973	522	SEX	465	\N	fa-calendar	\N	f	f	\N
5685	657	SEX	465	\N	fa-calendar	\N	f	f	\N
6063	730	QUI	2330	905	fa-calendar	\N	f	f	Lab 01
3939	517	SEX	468	\N	fa-calendar	\N	f	f	\N
3940	517	SEX	470	\N	fa-calendar	\N	f	f	EAD
3941	517	SEX	471	\N	fa-calendar	\N	f	f	EAD
3971	522	TER	462	190	fa-calendar	\N	f	f	\N
3936	517	QUI	467	191	fa-calendar	\N	f	f	\N
3937	517	QUI	467	191	fa-calendar	\N	f	f	\N
3938	517	QUI	467	191	fa-calendar	\N	f	f	\N
3933	517	QUA	469	192	fa-calendar	\N	f	f	\N
3934	517	QUA	469	192	fa-calendar	\N	f	f	\N
3935	517	QUA	469	192	fa-calendar	\N	f	f	\N
6064	729	SEX	2332	907	fa-calendar	\N	f	f	Lab 02
6065	730	SEX	2332	907	fa-calendar	\N	f	f	Lab 02
6082	723	QUA	2465	975	fa-calendar	\N	f	f	
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
900	Lara Sanches	\N
901	Edward Melo	\N
902	Aldo Mendes	\N
903	Rafael Marconi	\N
904	Jorge Osvaldo	\N
905	Grazielle Seabra	\N
906	Carmem Elena	\N
907	Hyago Santana	\N
908	Paulo Augusto	\N
909	Efrem Filho	\N
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
921	Edward Lima	\N
925	Lara Câmara Sanches	\N
926	Aldo Henrique	\N
929	Michel Junio	\N
931	Carmen Elena Ramirez	\N
964	Lara Câmara	\N
58	Prof. A Definir	\N
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
122	Prof. Osmundo	\N
123	Prof. Thais Ranielle	\N
128	Prof. Márcio	\N
133	Prof. Carla Danielle	\N
134	Prof. Fabiano	\N
135	Prof. Flávia Abreu	\N
975	Nenhum	\N
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
581	Ministro André Mendonça	\N
\.


--
-- Data for Name: turmas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.turmas (id, nome, semestre_ref, curso_id, turno_id, unidade) FROM stdin;
5	1º Período - Biomedicina	1º	4	1	Águas Claras
6	3º Período - Biomedicina	3º	4	1	Águas Claras
7	1º Período - Biomedicina (Noite)	1º	4	8	Águas Claras
8	3º Período - Biomedicina (Noite)	3º	4	8	Águas Claras
9	5º Período - Biomedicina (Noite)	5º	4	8	Águas Claras
721	Computação 1º Semestre (Manhã)	1º	10	1	Águas Claras
722	Computação 2º Semestre (Manhã)	2º	10	1	Águas Claras
723	Computação 3º Semestre (Manhã)	3º	10	1	Águas Claras
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
724	Computação 4º Semestre (Manhã)	4º	10	1	Águas Claras
725	Computação 5º Semestre (Manhã)	5º	10	1	Águas Claras
726	Computação 6º Semestre (Manhã)	6º	10	1	Águas Claras
727	Computação 7º Semestre (Manhã)	7º	10	1	Águas Claras
728	Computação 1º Semestre (Noite)	1º	10	8	Águas Claras
729	Computação 2º Semestre (Noite)	2º	10	8	Águas Claras
730	Computação 3º Semestre (Noite)	3º	10	8	Águas Claras
731	Computação 4º Semestre (Noite)	4º	10	8	Águas Claras
732	Computação 5º Semestre (Noite)	5º	10	8	Águas Claras
733	Computação 8º Semestre (Noite)	8º	10	8	Águas Claras
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
3	Assistente NAP	nap@escola.com	x	nap	nap123	\N	\N
4	NAP Águas Claras	napac@escola.com	x	nap	nap_ac	\N	Águas Claras
5	NAP Asa Sul	napasa@escola.com	x	nap	nap_asa	\N	Asa Sul
2	Prof. Michel	michel@escola.com	x	coordenador	michelTI	\N	\N
\.


--
-- Name: cursos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cursos_id_seq', 10, true);


--
-- Name: disciplinas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.disciplinas_id_seq', 2488, true);


--
-- Name: grade_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grade_id_seq', 6082, true);


--
-- Name: professores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.professores_id_seq', 975, true);


--
-- Name: turmas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.turmas_id_seq', 733, true);


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
-- Name: disciplinas disciplina_nome_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.disciplinas
    ADD CONSTRAINT disciplina_nome_unique UNIQUE (nome);


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
-- Name: professores professor_nome_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.professores
    ADD CONSTRAINT professor_nome_unique UNIQUE (nome);


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

\unrestrict bmGlYQD1tJ2t4hkaeO3j1e0qTSR4pcwCKxum8xEs0EY6pKdaoIEUXag9CFLmVHK

