#!/usr/bin/env sh
# HotClip — terapkan migrasi SQL ke database Supabase lewat psql di container
# (VPS tidak punya klien psql terpasang).
#
# Pemakaian (di VPS, dari /opt/hotclip):
#   sh scripts/apply-migrations.sh
#
# Env:
#   DATABASE_URL      (wajib, dibaca dari .env bila tidak diset)
#   MIGRATIONS_DIR    (default supabase/migrations)
#   PG_IMAGE          (default postgres:16-alpine)
#   DRY_RUN=1         hanya tampilkan file yang akan dijalankan
#
# Idempotent: semua migrasi memakai `create ... if not exists` /
# `drop policy if exists`, jadi aman dijalankan ulang.

set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  # shellcheck disable=SC1091
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL tidak diset dan tidak ditemukan di .env" >&2
  exit 1
fi

MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: direktori migrasi '$MIGRATIONS_DIR' tidak ada" >&2
  exit 1
fi

echo "==> Migrasi di $ROOT_DIR/$MIGRATIONS_DIR"
ls -1 "$MIGRATIONS_DIR"/*.sql

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 — tidak ada yang dieksekusi"
  exit 0
fi

for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  printf '\n==> [psql] %s\n' "$name"
  docker run --rm \
    -e DATABASE_URL \
    -v "$ROOT_DIR/$MIGRATIONS_DIR:/migrations:ro" \
    "$PG_IMAGE" \
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "/migrations/$name"
  echo "    OK: $name"
done

echo
echo "==> Selesai. Verifikasi cepat tabel publik:"
docker run --rm -e DATABASE_URL "$PG_IMAGE" \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "select table_name from information_schema.tables where table_schema='public' order by 1"
