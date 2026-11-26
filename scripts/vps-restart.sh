#!/usr/bin/env sh
# HotClip VPS — restart seluruh service di /opt/hotclip (docker-compose.vps.yml).
#
# Pemakaian (dari root repo lokal):
#   sh scripts/vps-restart.sh              # sync + restart semua (api, web, nginx, certbot)
#   sh scripts/vps-restart.sh --no-sync    # restart saja, tanpa mengirim file dari lokal
#   sh scripts/vps-restart.sh --build      # rebuild image api/web sebelum start
#   sh scripts/vps-restart.sh --local      # jalankan langsung di VPS (tanpa SSH)
#   sh scripts/vps-restart.sh --no-verify  # lewati pengecekan HTTPS di akhir
#
# Env yang dapat dioverride:
#   VPS_HOST   (default root@209.94.60.207)
#   VPS_DIR    (default /opt/hotclip)
#   DOMAIN     (default dibaca dari .env; dipakai untuk verifikasi)

set -eu

VPS_HOST="${VPS_HOST:-root@209.94.60.207}"
VPS_DIR="${VPS_DIR:-/opt/hotclip}"
COMPOSE_FILE="docker-compose.vps.yml"

SYNC=1
BUILD=0
LOCAL=0
VERIFY=1
for arg in "$@"; do
  case "$arg" in
    --no-sync)   SYNC=0 ;;
    --build)     BUILD=1 ;;
    --local)     LOCAL=1 ;;
    --no-verify) VERIFY=0 ;;
    -h|--help)   sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "argumen tidak dikenal: $arg (pakai --help)" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- 1. Sinkronisasi file konfigurasi (hanya saat dijalankan dari lokal) -----
if [ "$LOCAL" -eq 0 ] && [ "$SYNC" -eq 1 ]; then
  log "Sync konfigurasi ke ${VPS_HOST}:${VPS_DIR}"
  ssh "$VPS_HOST" "mkdir -p '${VPS_DIR}/infra/nginx' '${VPS_DIR}/scripts'"
  scp -q "${ROOT}/${COMPOSE_FILE}" "${VPS_HOST}:${VPS_DIR}/${COMPOSE_FILE}"
  scp -q "${ROOT}/infra/nginx/bootstrap.sh" "${VPS_HOST}:${VPS_DIR}/infra/nginx/bootstrap.sh"
  scp -q "${ROOT}/scripts/vps-restart.sh" "${VPS_HOST}:${VPS_DIR}/scripts/vps-restart.sh"
  echo "    compose + nginx bootstrap + vps-restart.sh tersinkron"
fi

# --- 2. Perintah restart yang dijalankan di VPS -----------------------------
build_flag=""
[ "$BUILD" -eq 1 ] && build_flag="--build"

REMOTE_CMD="set -eu
  cd '${VPS_DIR}'
  test -f .env || { echo 'ERROR: ${VPS_DIR}/.env tidak ada' >&2; exit 1; }
  test -f '${COMPOSE_FILE}' || { echo 'ERROR: ${COMPOSE_FILE} tidak ada' >&2; exit 1; }

  echo '--- validasi compose ---'
  docker compose -f '${COMPOSE_FILE}' --profile certbot config --quiet

  echo '--- start/rebuild semua service ---'
  docker compose -f '${COMPOSE_FILE}' --profile certbot up -d ${build_flag} --remove-orphans

  echo '--- status ---'
  docker compose -f '${COMPOSE_FILE}' --profile certbot ps"

if [ "$LOCAL" -eq 1 ]; then
  log "Restart service (lokal)"
  sh -c "$REMOTE_CMD"
else
  log "Restart service di ${VPS_HOST}"
  ssh "$VPS_HOST" "$REMOTE_CMD"
fi

# --- 3. Verifikasi HTTP/HTTPS ----------------------------------------------
if [ "$VERIFY" -eq 1 ]; then
  if [ "$LOCAL" -eq 1 ]; then
    DOMAIN_VAL="$(grep -E '^DOMAIN=' "${VPS_DIR}/.env" 2>/dev/null | cut -d= -f2-)"
    TARGET="https://127.0.0.1"
    CURL_EXTRA="-k --resolve ${DOMAIN_VAL:-localhost}:443:127.0.0.1"
  else
    DOMAIN_VAL="$(ssh "$VPS_HOST" "grep -E '^DOMAIN=' '${VPS_DIR}/.env' | cut -d= -f2-" || true)"
    TARGET="https://${DOMAIN_VAL:-localhost}"
    CURL_EXTRA=""
  fi

  log "Verifikasi ${TARGET} (domain=${DOMAIN_VAL:-unknown})"
  sleep 8

  root_code="$(curl -sS ${CURL_EXTRA} -o /dev/null -w '%{http_code}' --max-time 25 "${TARGET}/" || echo 000)"
  echo "    GET /            -> ${root_code}"

  health_body="$(curl -sS ${CURL_EXTRA} --max-time 25 "${TARGET}/api/health" || true)"
  echo "    GET /api/health  -> ${health_body:-<kosong>}"

  if [ "$root_code" = "200" ] && printf '%s' "$health_body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    echo "    RESULT: OK"
  else
    echo "    RESULT: GAGAL (cek: docker logs hotclip-nginx-1 / hotclip-certbot-1)" >&2
    exit 1
  fi
fi

log "Selesai"
