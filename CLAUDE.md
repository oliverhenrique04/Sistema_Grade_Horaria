# CLAUDE.md

Orientações para trabalhar neste repositório.

## O que é o sistema

Aplicação web de gestão de grades horárias acadêmicas: uma **área pública** de consulta
(alunos) e um **painel administrativo** protegido por login. Administra usuários, campus,
turnos, horários dos turnos, cursos, períodos letivos, turmas, disciplinas, professores,
locais e aulas.

## Stack

Node.js + Express 5 · PostgreSQL (driver `pg`, sem ORM) · EJS · Bootstrap 5 · JavaScript
(CommonJS). Validação com Zod. Testes com Jest + Supertest. Lint com ESLint 10 e Prettier.

## Arquitetura

Camadas com responsabilidade única, sem SQL fora dos repositories e sem regra de negócio
nas views:

```
app.js                     Sobe o servidor HTTP
src/app.js                 Fábrica do Express (criarApp) — usada por testes e pelo servidor
src/config/                env.js (configuração), db.js (pool + transacao), menu.js
src/routes/                Definição de rotas; admin.js agrega src/routes/admin/*
src/controllers/           HTTP: lê requisição, chama service, renderiza/redireciona
src/services/              Regras de negócio (conflitos, escopo, autenticação)
src/repositories/          Todo o SQL, sempre parametrizado
src/middlewares/           Sessão, autenticação, autorização, CSRF, segurança, erros, contexto
src/validators/            Schemas Zod por recurso
src/views/                 EJS: layouts/, partials/, admin/, publico/, auth/, erros/
src/database/              migrate.js (runner), cli.js, migrations/, seeds/
src/utils/                 erros, dias, formatadores, paginação, construtor de filtros
tests/                     Jest + Supertest (setup/ e helpers/)
```

Fluxo: `rota → middleware de autorização → controller → service → repository → banco`.

## Comandos

```bash
npm install                      # instalar dependências
npm start                        # produção
npm run dev                      # desenvolvimento (NODE_ENV=development, watch)

npm run migrate                  # aplica migrations pendentes
npm run migrate:status           # lista migrations aplicadas/pendentes
npm run seed                     # carga inicial (campus, turnos, horários, período, admin)
npm run usuario:senha -- email@dominio.com [senha]   # define senha de um usuário

npm test                         # Jest (NODE_ENV=test)
npm run lint                     # ESLint
npm run lint:fix
npm run format                   # Prettier
```

Ambientes: `src/config/env.js` carrega `.env.<NODE_ENV>` e depois `.env` (o específico tem
precedência). `.env.development` aponta para o banco de desenvolvimento; `.env.test` usa o
schema `teste_automatizado`; `.env` é produção. **Nunca** rode migrations de teste ou
desenvolvimento contra o banco de produção.

`./scripts/recriar-dev.sh` recria o banco de desenvolvimento a partir de um dump de
produção (leitura apenas em produção).

## Publicação

Dois diretórios, de propósito:

| | |
|---|---|
| `/var/www/grade-horaria-cursos` | trabalho — branches, testes, `node_modules` completo |
| `/var/www/grade-horaria-app` | **o que o systemd executa** — worktree em HEAD destacado |

O diretório publicado é um `git worktree` **destacado num commit**, nunca numa branch. Ele
não acompanha o `git checkout` feito no diretório de trabalho: trocar a versão no ar é ato
explícito, e o `HEAD` do worktree registra o que está publicado.

```bash
./scripts/deploy.sh              # publica o HEAD do diretório de trabalho
./scripts/deploy.sh main         # publica uma branch
./scripts/deploy.sh 790dfc4      # volta para um commit
./scripts/deploy.sh --status     # o que está no ar, sem publicar
```

O script recusa publicar com o diretório de trabalho sujo, roda `npm ci --omit=dev` só
quando as dependências mudaram e verifica se o serviço subiu, mostrando o comando de
rollback se não subir.

`grade-horaria-app/.env` é um link para o `.env` do diretório de trabalho — credencial em
um lugar só. `grade-horaria-app/storage/` tem ACL de escrita para `www-data`, que é como a
importação guarda a planilha entre a prévia e a confirmação.

## Testes

`npm test` roda a suíte inteira contra o schema definido em `.env.test`
(`teste_automatizado`), recriado do zero pelo `globalSetup` a cada execução.

Para rodar em paralelo com outra execução (ou isolar uma investigação), sobrescreva o
schema na linha de comando — o dotenv não sobrepõe variáveis já presentes no ambiente:

```bash
NODE_ENV=test DB_SCHEMA=teste_minha_branch npx jest tests/conflitos.test.js --runInBand
```

`tests/helpers/db.js` traz fábricas que criam as dependências sozinhas
(`await bd.criarTurma()` já resolve campus, curso, turno e período).
`tests/helpers/app.js` instancia a aplicação real: se `src/app.js` não carregar, a falha
é ruidosa de propósito — nunca acrescente um app substituto, porque ele mascara rota
quebrada respondendo 200.

`tests/aplicacao.test.js` guarda invariantes de arquitetura: nenhum stub pendente, nenhum
`TODO`, nenhum SQL fora dos repositories, `_csrf` em todo formulário POST e ausência de
autenticação por token na URL. Se um deles falhar, corrija o código — não o teste.

## Banco de dados

Migrations incrementais em `src/database/migrations/`, aplicadas em ordem alfabética e
registradas em `schema_migrations`. Cada migration roda na própria transação. Arquivos
`.sql` são executados direto; arquivos `.js` exportam `async up(cliente)`.

**Nunca** crie um schema que dê `DROP TABLE` para recriar o banco. Migrations são aditivas;
para descontinuar algo, mova ou marque como inativo.

O modelo antigo do sistema foi preservado no schema `legado` (tabelas `legado.grade`,
`legado.turmas`, etc., com as contagens em `legado.arquivamento`). Nada foi apagado.

Regras que o banco garante sozinho:

- `horarios_turno`: CHECK de **exatamente 50 minutos** por período e gatilho que impede
  sobreposição entre períodos ativos do mesmo turno (intervalos entre períodos são válidos).
- `aulas`: índice único parcial impede duas aulas ativas da mesma turma, disciplina, dia e
  horário. Duas disciplinas **diferentes** no mesmo horário passam pelo banco porque turma
  gerencial oferta em paralelo; o choque de agenda das demais turmas é barrado no
  `conflitoService`. Conflitos de professor e de local dependem da faixa real de horário
  (turnos diferentes podem coincidir no relógio) e são detectados lá, em transação — o de
  professor barra a gravação, o de local apenas informa (ver alocação de sala).
- `periodos_letivos`: índice único parcial garante no máximo um período marcado como atual.
- `turmas`: o código é único por **período letivo + campus** — o ERP repete o mesmo
  `CODTURMA` em filiais diferentes, e são turmas distintas.
- `aulas.origem_chave`: identidade da aula no sistema de origem. É o que faz a reimportação
  atualizar em vez de duplicar.

## Importação da grade (cubo do TOTVS)

`/admin/importacao` (somente perfil `admin`) carrega a grade a partir do `.xlsx` exportado
do TOTVS Educacional. O cubo de origem é o
`OXY.EDU.1.0028 - CONFERENCIA DE CADASTRO COM HORARIO - SALA` — a grafia em maiúsculas e
sem acento é a do menu do ERP, e a tela a exibe assim de propósito: é por ela que o
operador acha o relatório. Fluxo em duas etapas: o envio **simula** a carga inteira e
mostra o relatório; só a confirmação grava.

Como funciona, e por quê:

- **Prévia e gravação percorrem o mesmo código**, na mesma transação — a simulação termina
  com `ROLLBACK`. A prévia já passou pelo CHECK de 50 minutos, pelo gatilho de sobreposição
  e pelos índices únicos; ela não promete o que a gravação recusaria.
- **A carga é idempotente.** Campus casa por `codigo_externo` (FILIAL), curso por `codigo`
  (CODCURSO), disciplina por `codigo` (CODDISC), professor por `matricula` (CHAPA), turma
  por código dentro do período e campus, e aula por `origem_chave`
  (`IDTURMADISC|dia|hora`). Recarregar o mesmo arquivo não cria um único registro novo.
- **Turma gerencial.** Quando o cubo aponta `TURMA_GERENCIAL`, a disciplina compartilhada
  fica **só** na turma que a oferta; as linhas com `GERENCIADA = SIM` são espelhos e não
  viram aula. As turmas atendidas são criadas e ligadas por `turmas.turma_gerencial_id`.
  Turma gerencial não tem semestre curricular e pode ofertar disciplinas em paralelo no
  mesmo horário — o `conflitoService` libera esse caso e só ele.
- **Quem cursa cada aula.** `aula_turmas` registra as turmas atendidas por cada aula. A
  origem é `IDTURMADISC_GEREN`, que é por OFERTA e não por turma gerencial: `GPDIRM`
  atende do 1º ao 10º, mas cada disciplina dela serve a duas turmas. A view
  `vw_aulas_das_turmas` resolve as duas visões — a turma dona (`propria = TRUE`) e as que
  assistem — e é por ela que a grade de `DIR08M1` mostra a disciplina no semestre certo,
  sem duplicar a aula. Turma gerencial não aparece na consulta pública.
- **Co-docência.** `aulas.professor_id` continua sendo o professor principal (Titular tem
  precedência); a equipe completa fica em `aula_professores`.
- **O cubo não traz sala.** As aulas entram sem local e viram pendência para o NAP.
- **Nada é apagado.** Aulas que saem da planilha só são inativadas se o operador marcar a
  opção, e apenas nas turmas presentes no arquivo.

O leitor de `.xlsx` é próprio (`src/utils/planilha.js`, ZIP + XML sobre o `zlib` do Node) e
o upload também (`src/middlewares/upload.js`): as bibliotecas usuais para os dois casos
trazem dezenas de pacotes transitivos que nada mais no projeto usa.

### Alocação de sala em lote

O cubo não exporta sala: uma turma recém-importada chega com dezenas de aulas sem
local. No montador há **"Alocar sala em lote"** — escolhe-se o local uma vez e ele é
aplicado ao recorte desejado.

O recorte tem três eixos independentes, todos de seleção múltipla: **disciplinas**,
**dias da semana** e **horários**, mais o atalho "só as que estão sem local". Lista vazia
em qualquer eixo significa "todos", então quem não filtra nada alcança a turma inteira.
Cada opção mostra quantas aulas alcança e quantas ainda estão sem local — sem isso,
marcar uma caixa seria adivinhar o que vai acontecer. Disponível para os perfis que
editam aula, inclusive o `nap`.

Duas decisões que valem registrar:

- **Sala ocupada não impede alocar.** O conflito de tipo `local` é detectado e mostrado,
  mas não barra a gravação — em lugar nenhum: nem no lote, nem no formulário, nem no
  montador (`CONFLITOS_QUE_NAO_BLOQUEIAM`, em `aulaService`). A grade chega do TOTVS sem
  sala e o NAP aloca depois; travar no choque deixaria a aula sem sala sem que o operador
  pudesse resolver dali, e nem todo ambiente é exclusivo — laboratório com bancadas,
  clínica, auditório e quadra recebem mais de uma turma ao mesmo tempo.
- **Local inválido ainda recusa**, e recusa a operação inteira antes de tocar em qualquer
  aula: inexistente, inativo ou de outro campus é erro de cadastro, não disputa de agenda.
- **Aula herdada não é alterada** pela turma que só a assiste: ela pertence à turma
  gerencial, e mudar ali valeria para todas as turmas do grupo.

### Como a turma gerencial aparece no painel

O ensalamento do TOTVS é assim, e a interface precisa dar conta dele:

- na grade da gerencial, **cada aula exibe os semestres que atende** (selo roxo), com a
  lista de turmas no `title` — sem isso é impossível saber de quem é cada disciplina
  paralela;
- um seletor recorta a matriz por turma atendida (`?atendida=<id>`), deixando-a legível
  como a de uma turma comum;
- na grade da turma que apenas **assiste**, a aula aparece por inteiro mas sem os botões de
  editar/mover: alterá-la ali mudaria a grade de todas as outras turmas. Nada de rótulo
  "compartilhada" na tela — para o aluno é uma aula como qualquer outra;
- o formulário de aula da gerencial tem o campo **"Turmas que cursam esta disciplina"**,
  para manter o vínculo quando a aula é criada ou editada à mão. O campo oculto
  `turmas_atendidas_enviado` distingue "nenhuma turma marcada" de "campo não enviado".

## Autenticação e autorização

Login por e-mail e senha (bcrypt, custo 12). Sessões no PostgreSQL (`connect-pg-simple`),
cookie `httpOnly`, `secure` em produção, `sameSite`, expiração configurável e regeneração
da sessão após o login. **Não existe autenticação por token na URL** — a antiga rota
`/admin?token=...` foi eliminada e não deve voltar.

Perfis: `admin` (global), `coordenador` (restrito aos cursos vinculados em `usuario_cursos`)
e `nap` (restrito aos campus vinculados em `usuario_campus`, altera apenas informações
operacionais como local da aula). Um usuário pode ter vários cursos e vários campus.

Toda permissão é verificada no backend, em `src/middlewares/autorizacao.js`. Esconder botão
na view é conveniência, nunca controle de acesso. O recurso `importacao` é exclusivo do
`admin`: uma carga reescreve turmas e aulas de todos os cursos e campus de uma vez, o que
não cabe no escopo de coordenador nem de nap.

## Padrões de código

- Português nos nomes, comentários e mensagens ao usuário; sem acentos em identificadores.
- 4 espaços de indentação, aspas simples, ponto e vírgula (Prettier cuida disso).
- Controllers finos: sem SQL, sem regra de negócio, sem `try/catch` repetido — use
  `async(handler)` de `src/utils/erros.js` e deixe o tratador global responder.
- Erros de domínio usam as classes de `src/utils/erros.js`; o tratador global escolhe a
  página (403/404/500) e nunca vaza detalhes internos.
- Toda query é parametrizada. Nada de interpolar valor em SQL, nem tabela dinâmica.
- Proteção contra mass assignment: monte o objeto persistido campo a campo; nunca faça
  spread de `req.body`.
- Todo formulário POST inclui `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
- `<select data-buscavel="rótulo">` com 8 ou mais opções vira um combobox no padrão ARIA
  (`admin.js`): digita-se no próprio campo e a lista filtra abaixo, sem acento e sem caixa.
  O `<select>` original continua no formulário guardando o valor — é ele que é enviado — e
  sem JavaScript aparece inteiro, como sempre.
- CSS, JS e imagens nas views usam `asset('/caminho')`, não `withBase`: o `asset` carimba
  a URL com a data de modificação do arquivo. Sem esse selo, o cache de 7 dias dos
  estáticos entrega folha antiga sobre HTML novo depois de um deploy.
- Links, actions e assets nas views usam `withBase('/caminho')` para funcionar sob
  `BASE_PATH` (o sistema roda atrás de proxy reverso em `/grades`).
- Views não repetem o documento HTML: usam `include('../layouts/admin-inicio')` e
  `include('../layouts/admin-fim')` e os partials de `src/views/partials/`.
- Nunca registre em log senha, hash, cookie, token ou corpo de requisição de login.

## Decisões do projeto

- **Sem ORM.** SQL explícito nos repositories, mais previsível para as consultas de grade.
- **Sem módulo genérico de CRUD.** Cada recurso tem rota, controller, service, repository e
  validator próprios. A versão anterior manipulava qualquer tabela por nome vindo da URL —
  isso foi eliminado por segurança e clareza.
- **Semestre curricular é numérico** (`turmas.semestre_curricular`), não texto usado para
  ordenar.
- **Local é entidade** (`locais`), não texto livre; e **campus é entidade** (`campus`), não
  o antigo campo `unidade`.
- **Período letivo vem do banco** (`periodos_letivos.atual`); não pode ser fixado no HTML.
- **Dias de segunda a sábado** (`dia_semana` 1..6). Não limite a estrutura a cinco dias.
- **Exclusão destrutiva é evitada** em entidades com histórico: use ativação/desativação.
- **Semestre curricular é opcional.** Turma gerencial e turma especial (`DIRESPM1`)
  atravessam semestres; o formulário oferece "Não se aplica".
- **Sem dependência para ler planilha nem para receber upload.** Ver a seção de importação.
