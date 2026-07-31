# Sistema de Grade Horária Acadêmica

Aplicação web para montagem e consulta de grades horárias universitárias. Possui uma
**área pública** de consulta para alunos e um **painel administrativo** protegido por
login, com perfis de acesso e validação de conflitos de horário.

---

## Funcionalidades

### Área pública

- Consulta da grade filtrando por período letivo, campus, curso, semestre, turma e turno.
- Exibição de dia, horário inicial e final, disciplina, professor, local e modalidade.
- Funciona em desktop, celular e impressão.
- Não expõe dados administrativos.

### Painel administrativo

- Login por e-mail e senha, com sessão persistida no PostgreSQL.
- Perfis: administrador, coordenador e NAP (operador de campus).
- Cadastros de usuários, campus, turnos, horários dos turnos, cursos, períodos letivos,
  turmas, disciplinas, professores e locais — todos com busca, filtros, paginação,
  validação no servidor e ativação/desativação.
- Montador de grade em matriz (dias × horários do turno) com adicionar, editar, remover,
  copiar, mover e pré-visualização de conflitos.
- **Alocação de sala em lote**: aplica o mesmo local ao recorte escolhido, combinando
  disciplinas, dias da semana e horários (seleção múltipla em cada eixo) e o atalho
  "só as que estão sem local", reportando as que gerariam choque de sala.
- Dashboard com indicadores por escopo do usuário, incluindo pendências e conflitos.
- **Importação da grade a partir do cubo do TOTVS Educacional** (`.xlsx`), com conferência
  antes de gravar, carga idempotente e histórico das execuções.

### Regras de grade garantidas pelo sistema

- Cada período de horário tem **exatamente 50 minutos**.
- Períodos do mesmo turno **não podem se sobrepor**; intervalos entre eles são permitidos.
- Cada turno aceita **qualquer quantidade** de períodos.
- Uma turma não pode ter duas aulas no mesmo dia e horário — exceto a turma gerencial,
  que existe para concentrar disciplinas compartilhadas e as oferta em paralelo.
- Um professor não pode estar em duas aulas simultâneas, mesmo em cursos, turmas ou
  campus diferentes.
- Um local não pode receber duas aulas simultâneas (exceto ambientes virtuais).
- O horário escolhido precisa pertencer ao turno da turma.
- O local precisa pertencer ao campus da turma (exceto ambientes virtuais).
- Registros inativos não podem ser usados em novas aulas.
- Aulas de segunda a sábado.

---

## Tecnologias

Node.js · Express 5 · PostgreSQL (driver `pg`, sem ORM) · EJS · Bootstrap 5 · Zod ·
bcrypt · Jest + Supertest · ESLint + Prettier.

---

## Instalação

### 1. Pré-requisitos

- Node.js 20 ou superior
- PostgreSQL 14 ou superior

### 2. Dependências

```bash
git clone <url-do-repositorio>
cd grade-horaria-cursos
npm install
```

### 3. Variáveis de ambiente

```bash
cp .env.example .env
```

```env
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://usuario:senha@host:5432/grade_horaria
DB_SSL=false
DB_SCHEMA=public
BASE_PATH=
SESSION_SECRET=<gere um segredo longo>
SESSION_TTL_MINUTOS=480
COOKIE_SECURE=true
ADMIN_NOME=Administrador
ADMIN_EMAIL=admin@suainstituicao.edu.br
ADMIN_SENHA=
```

Gere o segredo de sessão com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

O carregamento é em camadas: `src/config/env.js` lê `.env.<NODE_ENV>` e depois `.env`,
com precedência para o arquivo específico do ambiente. Assim `.env.development` e
`.env.test` convivem com o `.env` de produção sem sobrescrevê-lo.

`BASE_PATH` permite servir a aplicação em um subcaminho atrás de proxy reverso
(ex.: `BASE_PATH=/grades`). O cabeçalho `X-Forwarded-Prefix` também é aceito.

### 4. Banco de dados

```bash
createdb grade_horaria
npm run migrate     # cria a estrutura
npm run seed        # campus, turnos, horários, período letivo e administrador
```

O `seed` cria o administrador a partir de `ADMIN_EMAIL`/`ADMIN_SENHA`. Se `ADMIN_SENHA`
estiver vazio, uma senha aleatória é gerada e exibida **uma única vez** no terminal.

Para definir ou redefinir a senha de qualquer usuário:

```bash
npm run usuario:senha -- usuario@dominio.com "NovaSenhaForte"
```

### 5. Executar

```bash
npm start           # produção
npm run dev         # desenvolvimento, com recarga automática
```

- Área pública: `http://localhost:3000/`
- Painel: `http://localhost:3000/admin` (redireciona para `/login`)

---

## Comandos

| Comando                                    | Descrição                              |
| ------------------------------------------ | -------------------------------------- |
| `npm start`                                | Sobe o servidor                        |
| `npm run dev`                              | Servidor em desenvolvimento com watch  |
| `npm run migrate`                          | Aplica migrations pendentes            |
| `npm run migrate:status`                   | Lista migrations aplicadas e pendentes |
| `npm run seed`                             | Carga inicial idempotente              |
| `npm run usuario:senha -- <email> [senha]` | Define a senha de um usuário           |
| `npm test`                                 | Testes automatizados                   |
| `npm run lint` / `npm run lint:fix`        | ESLint                                 |
| `npm run format` / `npm run format:check`  | Prettier                               |

---

## Estrutura do projeto

```
app.js                     Sobe o servidor HTTP
src/
├── app.js                 Fábrica do Express (criarApp)
├── config/                Configuração, pool do banco, definição do menu
├── routes/                Rotas (admin/ agrega um arquivo por recurso)
├── controllers/           Camada HTTP
├── services/              Regras de negócio (conflitos, escopo, autenticação, importação)
├── repositories/          Todo o SQL, sempre parametrizado
├── middlewares/           Sessão, autenticação, autorização, CSRF, segurança, erros
├── validators/            Schemas Zod por recurso
├── views/                 EJS: layouts/, partials/, admin/, publico/, auth/, erros/
├── database/              migrate.js, cli.js, migrations/, seeds/
└── utils/                 Erros, dias, formatadores, paginação, filtros, planilha, textos
public/                    CSS, JS e imagens
scripts/                   Utilitários de operação
storage/                   Planilhas enviadas aguardando confirmação (fora do versionamento)
tests/                     Jest + Supertest
```

---

## Segurança

- Autenticação por e-mail e senha; senhas com bcrypt (custo 12).
- **Não existe autenticação por token na URL.** A antiga rota `/admin?token=...` foi
  removida.
- Sessões persistidas no PostgreSQL, cookie `httpOnly`, `secure` em produção, `sameSite`
  configurável, expiração e regeneração da sessão após o login.
- Proteção CSRF em todas as requisições que alteram estado.
- Rate limiting no login.
- Helmet, limite de tamanho de requisição e tratamento global de erros.
- Queries parametrizadas e validação de entrada com Zod.
- Autorização por perfil verificada no backend, com proteção contra mass assignment.
- Proteção contra redirecionamento para domínios externos.
- Senhas, hashes, cookies e segredos nunca são registrados em log.

---

## Perfis de acesso

| Perfil                       | Alcance                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Administrador**            | Acesso global a todos os cadastros e grades                                                                               |
| **Coordenador**              | Cursos, turmas e grades vinculados ao seu escopo (`usuario_cursos`)                                                       |
| **NAP / operador de campus** | Consulta das grades do campus autorizado e alteração de informações operacionais, especialmente locais (`usuario_campus`) |

Um usuário pode estar vinculado a **vários cursos** e a **vários campus**.

---

## Modelo de dados

Entidades: `usuarios`, `usuario_cursos`, `usuario_campus`, `campus`, `turnos`,
`horarios_turno`, `cursos`, `curso_campus`, `periodos_letivos`, `turmas`, `disciplinas`,
`curso_disciplinas`, `professores`, `locais`, `aulas`, `aula_professores`, `importacoes`,
`session`.

Migrations incrementais em `src/database/migrations/`, registradas em `schema_migrations`.
Nenhuma migration recria o banco com `DROP TABLE`.

---

## Importação da grade (TOTVS)

`Administração → Importar grade` (perfil administrador) carrega a grade a partir do
`.xlsx` exportado do cubo de horários do TOTVS Educacional.

O envio **não grava nada**: a carga inteira é executada em modo de teste, com as mesmas
validações da gravação real, e desfeita. O relatório mostra o que vai acontecer; a
gravação só ocorre na confirmação, em uma única transação.

**A carga não duplica registros.** Cada entidade é reconhecida por um código estável do
ERP — filial, `CODCURSO`, `CODDISC`, chapa do professor, `CODTURMA` (dentro do período e do
campus) e `IDTURMADISC` para a aula. Recarregar a mesma planilha atualiza o que mudou.

Pontos do modelo do TOTVS que a importação trata:

| Situação no cubo                                     | O que o sistema faz                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TURMA_GERENCIAL = Sim`                              | A disciplina fica na turma que a oferta. As linhas `GERENCIADA = SIM` são espelhos e não viram aula; as turmas atendidas são criadas e ligadas à gerencial. |
| Mesma aula em várias linhas (um professor por linha) | Vira uma aula só. O titular fica como professor principal e a equipe completa em `aula_professores`.                                                        |
| Mesmo `CODTURMA` em filiais diferentes               | Turmas distintas, uma por campus.                                                                                                                           |
| Turma sem semestre no código (`GPDIRM`, `DIRESPM1`)  | Turma sem semestre curricular — o campo aceita "não se aplica".                                                                                             |
| Faixa de horário que não existe no turno             | Período de 50 minutos é criado no turno; faixa deslocada encaixa no período existente; o que não encaixa vira pendência sinalizada.                         |
| Planilha não traz sala                               | Aulas entram sem local, listadas como pendência para o NAP.                                                                                                 |

Aulas que saem da planilha só são inativadas se o operador marcar a opção — e apenas nas
turmas presentes no arquivo. Nada é apagado.

---

## Migração da versão anterior

A versão anterior usava outro modelo (`grade`, `turmas.unidade` como texto livre, `sala`
como texto livre, login por token na URL). Ao aplicar as migrations, essas tabelas são
**movidas para o schema `legado`** — nada é apagado:

```sql
SELECT * FROM legado.arquivamento;   -- o que foi arquivado e quantas linhas
SELECT * FROM legado.grade;          -- aulas do modelo antigo
SELECT * FROM legado.turmas;
```

O sistema novo inicia com os cadastros vazios, prontos para uso, com campus, turnos,
horários, período letivo e administrador criados pelo `seed`.

---

## Operação em produção

O serviço roda por systemd (`grade-horaria.service`, usuário `www-data`) atrás do nginx,
que serve a aplicação em `/grades` com `proxy_pass http://127.0.0.1:3000/` — repare na
barra final: o nginx **remove** o prefixo antes de repassar, e informa o caminho original
pelo cabeçalho `X-Forwarded-Prefix`. Por isso a aplicação monta as rotas na raiz e o
`BASE_PATH` só é usado para **gerar** URLs.

Consequência importante: o cookie de sessão precisa de `path: '/'`. Com `path=/grades`, o
`express-session` compara o caminho do cookie com `req.originalUrl` (que chega sem o
prefixo), detecta divergência e ignora a sessão inteira — o login se torna impossível.

Atualização com mudança de banco:

```bash
# 1. Backup (sempre)
pg_dump "$DATABASE_URL" --no-owner --no-privileges -f backups/producao-$(date +%F-%H%M).sql

# 2. Migrations e carga inicial
NODE_ENV=production npm run migrate
NODE_ENV=production npm run seed

# 3. Reiniciar
sudo systemctl restart grade-horaria.service
sudo systemctl status grade-horaria.service
```

O `.env` de produção precisa conter `SESSION_SECRET` (a aplicação recusa iniciar sem ele)
e deve ser legível pelo `www-data`:

```bash
chgrp www-data .env && chmod 640 .env
```

## Licença

ISC.
