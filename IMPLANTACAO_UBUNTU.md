# Implantação no Ubuntu (Nginx + Node.js + PM2)

Guia para publicar o sistema em `https://nuted.unieuro.edu.br/grades/`.

## 1. Pré-requisitos

```bash
sudo apt update
sudo apt install -y git curl nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

Valide:

```bash
node -v
npm -v
nginx -v
psql --version
pm2 -v
```

## 2. Publicar código no servidor

```bash
sudo mkdir -p /var/www/grade-horaria
sudo chown -R $USER:$USER /var/www/grade-horaria
git clone <URL_DO_REPOSITORIO> /var/www/grade-horaria
cd /var/www/grade-horaria
```

Se o projeto já existe no diretório:

```bash
cd /var/www/grade-horaria
git pull
```

## 3. Variáveis de ambiente (.env)

```bash
cp .env.example .env
nano .env
```

Exemplo:

```env
PORT=3100
DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/grade_horaria
DB_SSL=false
BASE_PATH=/grades
```

`BASE_PATH` é opcional, mas recomendado em produção com subcaminho.
Se não definir, o sistema usa `X-Forwarded-Prefix` enviado pelo Nginx.

## 4. Banco de dados

```bash
sudo -u postgres createdb grade_horaria
psql -h 127.0.0.1 -U postgres -d grade_horaria -f src/database/schema.sql
```

## 5. Instalar dependências

No diretório correto (`/var/www/grade-horaria`):

```bash
npm install
```

## 6. Subir aplicação com PM2

```bash
cd /var/www/grade-horaria
pm2 start app.js --name grade-horaria
pm2 save
pm2 startup systemd -u $USER --hp /home/$USER
```

Verificar:

```bash
pm2 status
pm2 logs grade-horaria --lines 100
curl -I http://127.0.0.1:3100
```

Se retornar `Connection refused`, a aplicação não subiu. Verifique `pm2 logs`.

## 7. Configurar Nginx para /grades/

No arquivo do site (ex.: `/etc/nginx/sites-available/nuted`), adicione:

```nginx
upstream grade_horaria_app {
    server 127.0.0.1:3100;
    keepalive 32;
}

location = /grades { return 301 /grades/; }
location /grades/ {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /grades;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120;
    proxy_pass http://grade_horaria_app/;
}
```

Esse bloco publica o sistema exclusivamente no subcaminho `/grades/` do domínio `nuted.unieuro.edu.br`.

> Importante: se aparecer `host not found in upstream "grade_horaria_app"`, o bloco `upstream grade_horaria_app` está ausente ou fora do escopo do `http`.

Testar e recarregar:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Firewall (se necessário)

```bash
sudo ufw allow 'Nginx Full'
sudo ufw status
```

## 9. Verificações finais

- Público: `https://nuted.unieuro.edu.br/grades/`
- Admin: `https://nuted.unieuro.edu.br/grades/admin?token=SEU_TOKEN`

Comandos úteis:

```bash
pm2 restart grade-horaria
pm2 logs grade-horaria --lines 200
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## 10. Troubleshooting rápido

### `npm ERR! EACCES: permission denied`
Corrija dono/permissão da pasta:

```bash
sudo chown -R $USER:$USER /var/www/grade-horaria
```

### `npm ERR! ENOENT ... package.json`
Você está em pasta errada. Confirme:

```bash
cd /var/www/grade-horaria
ls -la
```

### `curl -I http://127.0.0.1:3100` falha
- App não iniciou em `PORT=3100`
- PM2 não está rodando processo
- Erro de `.env` ou conexão com banco

### `nginx -t` com upstream inválido
- Garanta `upstream grade_horaria_app { server 127.0.0.1:3100; }`
- Não use hostname inexistente no `server` do upstream
