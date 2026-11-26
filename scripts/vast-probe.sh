#!/usr/bin/env sh
# HotClip — Vast.ai provisioning smoke-test (search -> create -> destroy).
#
# Memvalidasi perbaikan `request_instance`: Vast menolak PUT /asks/<offer_id>/
# dengan 400 Bad Request bila `image` null, jadi bridge sekarang mengirim image
# nyata + disk yang cukup.
#
# JAMINAN BIAYA: instance yang dibuat di-destroy lewat `trap ... EXIT`, jadi
# destroy tetap dijalankan walau skrip error / di-CTRL-C. Di akhir skrip
# ditampilkan daftar instance aktif milik akun sebagai bukti tidak ada GPU
# yang tertinggal menyala.
#
# Pemakaian (di VPS, dari /opt/hotclip):
#   sh scripts/vast-probe.sh
#
# Env:
#   CONTAINER   nama container api (default hotclip-api-1)
#   PROBE_DISK  ukuran disk GB (default 60)
#   KEEP=1      JANGAN destroy (untuk inspeksi manual) — biaya berjalan!

set -u

CONTAINER="${CONTAINER:-hotclip-api-1}"
PROBE_DISK="${PROBE_DISK:-60}"
KEEP="${KEEP:-0}"

cd "$(dirname "$0")/.." || exit 1

log() { printf '\n==> %s\n' "$*"; }

# `docker exec` VPS tidak punya flag -T (itu milik `docker compose exec`).
dexec() { docker exec "$CONTAINER" sh -c "$1"; }

INSTANCE_ID=""

# ---------------------------------------------------------------- cleanup ---
cleanup() {
  if [ -n "$INSTANCE_ID" ] && [ "$KEEP" != "1" ]; then
    log "cleanup: destroy instance $INSTANCE_ID (hentikan billing)"
    dexec "python3 scripts/vast_manager.py release --api-key \"\$VAST_API_KEY\" --instance-id $INSTANCE_ID" \
      || echo "WARN: release gagal — destroy manual di console.vast.ai"
    INSTANCE_ID=""
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ------------------------------------------------------------------ 1) sync -
log "copy vast_manager.py terbaru ke $CONTAINER"
docker cp scripts/vast_manager.py "$CONTAINER":/app/scripts/vast_manager.py || exit 1

# ---------------------------------------------------------------- 2) search -
log "search (hard limits dari env / default baru, query sama seperti bridge TS)"
# Tanpa --query, SDK hanya mengembalikan 5 offer teratas by skor (umumnya
# mahal) dan semuanya ditolak filter — jadi kirim query harga/VRAM yang sama
# dengan `buildQuery()` di src/server/vast-client.ts.
dexec 'python3 scripts/vast_manager.py search --api-key "$VAST_API_KEY" --limit 20 --query "{\"dph_total\":{\"lte\":0.35},\"gpu_ram\":{\"gte\":6},\"cpu_cores_effective\":{\"gte\":2},\"disk_space\":{\"gte\":15},\"inet_down\":{\"gte\":100},\"inet_up\":{\"gte\":100},\"reliability2\":{\"gte\":0.95}}"' \
  > /tmp/hotclip-offers.json 2>/tmp/hotclip-offers.err
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "search FAILED (rc=$rc):"
  tail -5 /tmp/hotclip-offers.err
  exit 1
fi

COUNT="$(python3 -c '
import json
try:
    offers = json.load(open("/tmp/hotclip-offers.json"))
except Exception:
    offers = []
print(len(offers) if isinstance(offers, list) else 0)
')"
FIRST="$(python3 -c '
import json
try:
    offers = json.load(open("/tmp/hotclip-offers.json"))
except Exception:
    offers = []
if isinstance(offers, list) and offers:
    o = offers[0]
    print(o.get("id") or o.get("offer_id") or "")
' 2>/dev/null)"

echo "jumlah offer lolos filter: $COUNT"
echo "offer pertama: ${FIRST:-<tidak ada>}"

if [ -z "$FIRST" ]; then
  echo "Tidak ada offer yang lolos hard limits — provisioning tidak bisa diuji."
  exit 0
fi

# --------------------------------------------------------------- 3) request -
log "request instance dari offer $FIRST (disk ${PROBE_DISK}GB, image default)"
dexec "VAST_DISK_GB=$PROBE_DISK python3 scripts/vast_manager.py request \
  --api-key \"\$VAST_API_KEY\" --offer-id $FIRST --workspace /data/work" \
  > /tmp/hotclip-request.json 2>/tmp/hotclip-request.err
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "request FAILED (rc=$rc):"
  tail -8 /tmp/hotclip-request.err
  echo "--- stdout ---"
  head -c 300 /tmp/hotclip-request.json
  echo
  exit 1
fi

echo "--- respons (potong 400 byte) ---"
head -c 400 /tmp/hotclip-request.json
echo

CID="$(python3 -c '
import json
try:
    payload = json.load(open("/tmp/hotclip-request.json"))
except Exception:
    raise SystemExit
if not isinstance(payload, dict):
    raise SystemExit
for key in ("new_contract", "instance_id", "id"):
    value = payload.get(key)
    if value:
        print(value)
        break
' 2>/dev/null)"

if [ -z "$CID" ]; then
  echo "Respons tidak memuat id instance — periksa payload di atas."
  exit 1
fi

INSTANCE_ID="$CID"
echo "INSTANCE_ID=$INSTANCE_ID  (trap aktif: akan di-destroy otomatis)"

# --------------------------------------------------------------- 4) destroy -
if [ "$KEEP" = "1" ]; then
  log "KEEP=1 — instance DIBIARKAN HIDUP (destroy manual diperlukan)"
else
  log "destroy instance $INSTANCE_ID"
  if dexec "python3 scripts/vast_manager.py release --api-key \"\$VAST_API_KEY\" --instance-id $INSTANCE_ID"; then
    echo "destroy OK"
    INSTANCE_ID=""   # sukses → trap tidak perlu mengulang
  else
    echo "WARN: destroy via bridge gagal — trap akan mencoba lagi di EXIT"
  fi
fi

# ------------------------------------------------- 5) daftar instance aktif -
log "daftar instance aktif milik akun (bukti tidak ada GPU tertinggal)"
dexec 'python3 - <<PY
import os, json
from vastai import VastAI
vast = VastAI(api_key=os.environ["VAST_API_KEY"])
try:
    insts = vast.show_instances() or []
except Exception as exc:
    print("list FAILED:", exc)
    raise SystemExit(0)
rows = []
for i in insts:
    if not isinstance(i, dict):
        continue
    rows.append({
        "id": i.get("id"),
        "status": i.get("actual_status") or i.get("status"),
        "gpu": i.get("gpu_name"),
        "dph": i.get("dph_total"),
    })
print(json.dumps(rows, indent=2))
print("TOTAL_INSTANCES=%d" % len(rows))
PY' || echo "WARN: gagal membaca daftar instance"

log "selesai"
