#!/usr/bin/env bash
#
# Publica uma versao do sistema.
#
# O diretorio que o systemd executa (/var/www/grade-horaria-app) e um worktree
# do git em HEAD destacado: ele NAO acompanha a branch em check-out no
# diretorio de trabalho. Trocar o que esta no ar passa obrigatoriamente por
# aqui, e o commit publicado fica registrado no proprio HEAD do worktree.
#
#   ./scripts/deploy.sh                 publica o HEAD do diretorio de trabalho
#   ./scripts/deploy.sh main            publica uma branch
#   ./scripts/deploy.sh 790dfc4         publica um commit (rollback)
#   ./scripts/deploy.sh --status        mostra o que esta no ar, sem publicar
#
set -euo pipefail

REPO=/var/www/grade-horaria-cursos
APP=/var/www/grade-horaria-app
SERVICO=grade-horaria.service

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }

no_ar() {
    local sha
    sha=$(git -C "$APP" rev-parse --short HEAD)
    printf 'no ar    %s  %s\n' "$sha" "$(git -C "$APP" log -1 --format=%s)"
    printf 'servico  %s desde %s\n' \
        "$(systemctl is-active "$SERVICO")" \
        "$(systemctl show "$SERVICO" -p ActiveEnterTimestamp --value)"
}

if [[ "${1:-}" == "--status" ]]; then
    no_ar
    exit 0
fi

ALVO=${1:-HEAD}

# Resolve no repositorio de trabalho: aceita branch, tag ou sha.
if ! SHA=$(git -C "$REPO" rev-parse --verify "${ALVO}^{commit}" 2>/dev/null); then
    vermelho "Referencia desconhecida: ${ALVO}"
    exit 1
fi

if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
    vermelho 'O diretorio de trabalho tem alteracoes nao commitadas.'
    vermelho 'Só se publica o que esta commitado — commite ou descarte antes.'
    exit 1
fi

ATUAL=$(git -C "$APP" rev-parse HEAD)

if [[ "$ATUAL" == "$SHA" ]]; then
    verde "Ja esta no ar: $(git -C "$APP" rev-parse --short HEAD)"
    no_ar
    exit 0
fi

echo "publicando  $(git -C "$REPO" rev-parse --short "$SHA")  $(git -C "$REPO" log -1 --format=%s "$SHA")"

# `--detach` de proposito: o deploy aponta para um commit, nunca para uma
# branch que alguem possa mover sem perceber.
git -C "$APP" checkout --detach --quiet "$SHA"

# Reinstala so quando as dependencias mudaram — `npm ci` apaga node_modules.
if ! git -C "$REPO" diff --quiet "$ATUAL" "$SHA" -- package-lock.json package.json; then
    echo 'dependencias mudaram: npm ci'
    (cd "$APP" && npm ci --omit=dev --silent)
fi

sudo systemctl restart "$SERVICO"
sleep 3

if ! systemctl is-active --quiet "$SERVICO"; then
    vermelho "O servico nao subiu. Ultimas linhas do log:"
    journalctl -u "$SERVICO" -n 20 --no-pager
    vermelho "Para voltar:  $0 $(git -C "$REPO" rev-parse --short "$ATUAL")"
    exit 1
fi

verde 'publicado'
no_ar
