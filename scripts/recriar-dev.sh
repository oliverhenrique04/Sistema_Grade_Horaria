#!/usr/bin/env bash
# Recria o banco de desenvolvimento a partir de uma copia fiel da producao.
# Uso: ./scripts/recriar-dev.sh
#
# Le DATABASE_URL de .env (producao, somente leitura) e recria o banco
# apontado por .env.development. Nenhuma escrita e feita em producao.
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
. ./.env
PROD_URL="$DATABASE_URL"
# shellcheck disable=SC1091
. ./.env.development
DEV_URL="$DATABASE_URL"
set +a

DEV_DB="${DEV_URL##*/}"
ADMIN_URL="${DEV_URL%/*}/postgres"
DUMP="$(mktemp /tmp/grade_prod_XXXXXX.sql)"
trap 'rm -f "$DUMP"' EXIT

if [ "${PROD_URL##*/}" = "$DEV_DB" ]; then
    echo "ERRO: .env e .env.development apontam para o mesmo banco. Abortado." >&2
    exit 1
fi

echo "==> Exportando producao (somente leitura)"
pg_dump "$PROD_URL" --no-owner --no-privileges -f "$DUMP"

echo "==> Recriando $DEV_DB"
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$DEV_DB\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$DEV_DB\""

echo "==> Restaurando snapshot"
psql "$DEV_URL" -q -v ON_ERROR_STOP=1 -f "$DUMP" >/dev/null

echo "==> Pronto. Rode: NODE_ENV=development npm run migrate && NODE_ENV=development npm run seed"
