
# Sistema de Grade Horária Acadêmica

Um sistema web completo para gestão e visualização de horários de aulas universitárias. O projeto conta com uma área administrativa para coordenação (CRUDs e montagem de grade) e uma interface pública moderna e responsiva para os alunos.

---

## Funcionalidades

### Área Pública (Alunos)
* **Visualização Clara:** Grade horária organizada por dias da semana.
* **Filtros Inteligentes:** Seleção por Curso (exibe o Coordenador responsável).
* **Abas de Turnos:** Navegação fluida entre Integral, Matutino, Vespertino e Noturno.
* **Identidade Visual:** Cores e ícones dinâmicos para cada turno (ex: Amarelo para Vespertino, Azul para Noturno).
* **Responsividade:** Funciona bem em celulares e desktops.

### Área Administrativa (Coordenação)
* **Painel de Controle:** Dashboard com acesso rápido a todas as funções.
* **Gerenciamento Completo (CRUD):**
    * Cursos (com Coordenador e total de semestres).
    * Turmas (Vínculo com Curso, Turno e Semestre).
    * Disciplinas, Professores e Usuários.
* **Montador de Grade Visual:** Interface intuitiva para associar *Disciplina + Professor + Dia* a uma turma específica.
* **Segurança:** Proteção contra exclusão de registros que possuem dependências.

---

## Tecnologias Utilizadas

* **Backend:** Node.js, Express.
* **Banco de Dados:** PostgreSQL.
* **Frontend:** EJS (Template Engine), CSS3 (Custom Properties), Bootstrap 5 (Admin).
* **Ícones:** FontAwesome 6.

---

## Instalação e Configuração

Siga estes passos para rodar o projeto localmente ou no GitHub Codespaces.

### 1. Pré-requisitos
* Node.js instalado.
* PostgreSQL instalado e rodando.

### 2. Clonar e Instalar Dependências
```bash
git clone [https://github.com/seu-usuario/seu-repo.git](https://github.com/seu-usuario/seu-repo.git)
cd Sistema_Grade_Horaria
npm install
```

### 3. Configurar variáveis de ambiente
Crie o arquivo `.env` na raiz (ou copie de `.env.example`) e ajuste:

```env
PORT=3000
DATABASE_URL=postgresql://SEU_USUARIO:SUA_SENHA@SEU_HOST:5432/grade_horaria
DB_SSL=false
```

### 4. Configurar o Banco de Dados

O sistema espera um banco de dados chamado `grade_horaria`.

**Passo A: Iniciar o serviço (se estiver no Linux/Codespaces)**

```bash
sudo service postgresql start

```

**Passo B: Criar o Banco e Tabelas**
Execute o comando abaixo para criar o banco e importar a estrutura (tabelas e dados iniciais):

```bash
createdb -h 127.0.0.1 -U postgres grade_horaria
psql -h 127.0.0.1 -U postgres -d grade_horaria -f src/database/schema.sql

```

> **Nota:** Usuários do admin não são criados automaticamente no schema por segurança. Crie manualmente os usuários com `token_acesso` no banco.

### 5. Rodar o Projeto

```bash
node app.js

```

Acesse no navegador: `http://localhost:3000`

---

## Estrutura do Projeto

```
Sistema_Grade_Horaria/
├── node_modules/
├── public/              # Arquivos estáticos (CSS, Imagens)
│   └── css/
│       └── style.css    # Estilos da área pública
├── src/
│   ├── controllers/     # Lógica das rotas
│   │   ├── adminController.js
│   │   └── publicController.js
│   ├── database/        # Configuração do Banco
│   │   ├── db.js        # Conexão Pool
│   │   └── schema.sql   # Estrutura das tabelas
│   ├── routes/          # Definição das rotas (URL)
│   │   └── index.js
│   └── views/           # Telas (HTML/EJS)
│       ├── admin/       # Telas do Painel (Listar, Form, Grade)
│       └── public/      # Tela Inicial (index.ejs)
├── app.js               # Arquivo principal do servidor
└── package.json

```

---

## Acesso em Produção (NUTED)

Implantação com Nginx em:

- Público: `https://nuted.unieuro.edu.br/grades/`
- Admin: `https://nuted.unieuro.edu.br/grades/admin?token=SEU_TOKEN`

## Acesso ao Admin (Ambiente Local)

Para acessar localmente, vá para `/admin?token=SEU_TOKEN`.

O token deve existir na tabela `usuarios.token_acesso`.

Exemplo de criação manual de usuário admin:

```sql
INSERT INTO usuarios (nome, email, senha, tipo, token_acesso)
VALUES ('Administrador', 'admin@dominio.com', 'SENHA_FORTE', 'admin', 'TOKEN_ADMIN');
```



---

## Solução de Problemas Comuns (Codespaces)

Se você estiver rodando no GitHub Codespaces e encontrar erros de conexão, siga este guia:

### Erro: `Connection refused` ou `password authentication failed`

O banco de dados do Codespaces pode "dormir" ou resetar as configurações de permissão.

**Solução (Kit de Reanimação):**
Rode estes comandos no terminal para reiniciar o banco e liberar o acesso:

```bash
# 1. Iniciar o serviço
sudo service postgresql start

# 2. Configurar permissão total local (Trust)
sudo sed -i -e 's/md5/trust/g' -e 's/peer/trust/g' -e 's/scram-sha-256/trust/g' $(sudo find /etc/postgresql -name pg_hba.conf)

# 3. Reiniciar para aplicar
sudo service postgresql restart

# 4. (Opcional) Se o banco sumiu, recrie-o:
createdb -h 127.0.0.1 -U postgres grade_horaria
psql -h 127.0.0.1 -U postgres -d grade_horaria -f src/database/schema.sql

```

### Erro: `Cannot read properties of null (reading 'substring')`

Isso acontece se existirem Turnos no banco de dados sem o "Slug" (identificador) preenchido.

**Solução:**
Rode este SQL para corrigir os dados:

```bash
psql -h 127.0.0.1 -U postgres -d grade_horaria -c "UPDATE turnos SET slug = LOWER(nome) WHERE slug IS NULL;"
