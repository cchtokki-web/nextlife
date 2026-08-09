#!/bin/sh
set -eu

DATA_DIR=/app/data
DATABASE_PATH="$DATA_DIR/dev.db"
RESET_MARKER="$DATA_DIR/.email-only-reset-v1"
DATABASE_URL="file:$DATABASE_PATH"

mkdir -p "$DATA_DIR"

if [ ! -f "$DATABASE_PATH" ]; then
  echo "Initializing database..."
  cp /app/default.db "$DATABASE_PATH"
elif [ ! -f "$RESET_MARKER" ]; then
  echo "Resetting legacy account data while preserving analytics..."
  prisma db execute \
    --url "$DATABASE_URL" \
    --file /app/prisma/reset-account-data.sql
fi

echo "Checking and applying database schema..."
cd /app
export DATABASE_URL
prisma db push --accept-data-loss

# SQL 초기화와 스키마 적용이 모두 성공한 경우에만 다음 실행부터 초기화를 건너뛴다.
if [ ! -f "$RESET_MARKER" ]; then
  touch "$RESET_MARKER"
fi

chown -R nextjs:nodejs "$DATA_DIR"
exec su nextjs -s /bin/sh -c "node server.js"
