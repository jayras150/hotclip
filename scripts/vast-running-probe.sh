#!/usr/bin/env sh
# HotClip — probe Vast.ai: tunggu sampai actual_status == "running", catat
# waktu boot riil, lalu buktikan bahwa direct_port_start benar-benar menjadi
# port HTTP yang hidup.
#
# Kenapa pakai image kecil + onstart stub HTTP:
#   `show_instance` Vast TIDAK mengembalikan map `ports` untuk instance docker
#   biasa; yang ada hanya rentang `direct_port_start..+direct_port_count`.
#   Supaya "port hidup" bisa DIBUKTIKAN (bukan diasumsikan), instance diboot
#   dengan `python3 -m http.server 8080` sehingga GET pada port itu menjawab 200.
#
# JAMINAN BIAYA: instance di-destroy lewat `trap ... EXIT` (juga INT/TERM),
# jadi destroy tetap jalan walau skrip gagal / di-CTRL-C.
#
# Pemakaian (di VPS, dari /opt/hotclip):
#   sh scripts/vast-running-probe.sh
#
# Env:
#   CONTAINER      nama container api (default hotclip-api-1)
#   PROBE_IMAGE    image instance (default python:3.12-slim — boot cepat)
#   PROBE_DISK     disk GB (default 35)
#   PROBE_PORT     container port yang dipublish (default 8080)
#   READY_TIMEOUT  batas tunggu status running, detik (default 300)
#   KEEP=1         jangan destroy

set -u

CONTAINER="${CONTAINER:-hotclip-api-1}"
PROBE_IMAGE="${PROBE_IMAGE:-python:3.12-slim}"
PROBE_DISK="${PROBE_DISK:-35}"
PROBE_PORT="${PROBE_PORT:-8080}"
READY_TIMEOUT="${READY_TIMEOUT:-300}"
POLL_SEC=10
KEEP="${KEEP:-0}"

cd "$(dirname "$0")/.." || exit 1

log() { printf '\n==> %s\n' "$*"; }
dexec() { docker exec "$CONTAINER" sh -c "$1"; }

INSTANCE_ID=""

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

# ---------------------------------------------------------------- 1) sync ---
log "copy vast_manager.py terbaru (punya --direct) ke $CONTAINER"
docker cp scripts/vast_manager.py "$CONTAINER":/app/scripts/vast_manager.py || exit 1
dexec 'python3 scripts/vast_manager.py request --help 2>&1 | grep -c -- "--direct"' \
  | sed 's/^/    --direct ditemukan di help: /'

# -------------------------------------------------------------- 2) search ---
log "search (dph_total ascending, filter disk>=${PROBE_DISK} inet>=400)"
dexec 'python3 scripts/vast_manager.py search --api-key "$VAST_API_KEY" --limit 20 --query "{\"dph_total\":{\"lte\":0.35},\"gpu_ram\":{\"gte\":6},\"cpu_cores_effective\":{\"gte\":2},\"disk_space\":{\"gte\":35},\"inet_down\":{\"gte\":400},\"inet_up\":{\"gte\":400},\"reliability2\":{\"gte\":0.95}}"' \
  > /tmp/hc-run-offers.json 2>/tmp/hc-run-offers.err
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "search FAILED (rc=$rc):"; tail -5 /tmp/hc-run-offers.err; exit 1
fi

COUNT="$(python3 -c '
import json
try: d=json.load(open("/tmp/hc-run-offers.json"))
except Exception: d=[]
print(len(d) if isinstance(d,list) else 0)
')"
FIRST="$(python3 -c '
import json
try: d=json.load(open("/tmp/hc-run-offers.json"))
except Exception: d=[]
print(d[0].get("id") if isinstance(d,list) and d else "")
' 2>/dev/null)"

echo "jumlah offer lolos filter: $COUNT"
echo "offer termurah: ${FIRST:-<tidak ada>}"
if [ -z "$FIRST" ]; then echo "Tidak ada offer lolos filter — probe dihentikan."; exit 0; fi

# ------------------------------------------------------------- 3) request ---
log "request instance (image=$PROBE_IMAGE, disk=${PROBE_DISK}GB, -p ${PROBE_PORT}, direct, onstart stub HTTP)"
dexec "VAST_DISK_GB=$PROBE_DISK python3 scripts/vast_manager.py request \
  --api-key \"\$VAST_API_KEY\" --offer-id $FIRST --image $PROBE_IMAGE \
  --port $PROBE_PORT --direct --onstart \"python3 -m http.server $PROBE_PORT\"" \
  > /tmp/hc-run-req.json 2>/tmp/hc-run-req.err
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "request FAILED (rc=$rc):"; tail -8 /tmp/hc-run-req.err
  echo "--- stdout ---"; head -c 300 /tmp/hc-run-req.json; echo; exit 1
fi

INSTANCE_ID="$(python3 -c '
import json
d=json.load(open("/tmp/hc-run-req.json"))
print(d.get("new_contract") or d.get("instance_id") or d.get("id") or "")
' 2>/dev/null)"
if [ -z "$INSTANCE_ID" ]; then
  echo "Respons tanpa id instance:"; head -c 400 /tmp/hc-run-req.json; echo; exit 1
fi
echo "INSTANCE_ID=$INSTANCE_ID  (trap aktif — akan di-destroy otomatis)"

# ---------------------------------------------------------- 4) wait ready ---
log "tunggu actual_status == running (maks ${READY_TIMEOUT}s, poll ${POLL_SEC}s)"
START_EPOCH=$(date +%s)
BOOT_SEC=""
while :; do
  ELAPSED=$(( $(date +%s) - START_EPOCH ))
  [ "$ELAPSED" -ge "$READY_TIMEOUT" ] && break

  dexec "python3 scripts/vast_manager.py show --api-key \"\$VAST_API_KEY\" --instance-id $INSTANCE_ID" \
    > /tmp/hc-run-show.json 2>/dev/null

  STATUS="$(python3 -c '
import json
try: d=json.load(open("/tmp/hc-run-show.json"))
except Exception: d={}
print(d.get("actual_status") or d.get("status") or "")
' 2>/dev/null)"
  printf '   t=%ss status=%s\n' "$ELAPSED" "${STATUS:-<null>}"

  if [ "$STATUS" = "running" ]; then
    BOOT_SEC="$ELAPSED"
    break
  fi
  sleep "$POLL_SEC"
done

if [ -z "$BOOT_SEC" ]; then
  echo "TIMEOUT: instance belum running dalam ${READY_TIMEOUT}s"
  exit 1
fi

# ------------------------------------------------ 5) verifikasi port hidup --
log "detail instance setelah running"
python3 -c '
import json
d = json.load(open("/tmp/hc-run-show.json"))
for k in ("id","actual_status","public_ipaddr","direct_port_start","direct_port_end",
          "direct_port_count","gpu_name","dph_total","disk_space","image_uuid"):
    print(f"   {k:20s}= {d.get(k)}")
print(f"   BOOT_SECONDS        = '$BOOT_SEC'")
'

IP="$(python3 -c 'import json;print(json.load(open("/tmp/hc-run-show.json")).get("public_ipaddr") or "")')"
DS="$(python3 -c 'import json;print(int(json.load(open("/tmp/hc-run-show.json")).get("direct_port_start") or 0))')"
DC="$(python3 -c 'import json;print(int(json.load(open("/tmp/hc-run-show.json")).get("direct_port_count") or 0))')"

log "uji HTTP ke setiap port di rentang direct (membuktikan port benar-benar hidup)"
if [ -z "$IP" ] || [ "$DS" -le 0 ]; then
  echo "   public_ipaddr/direct_port_start tidak tersedia — mapping belum bisa diverifikasi"
else
  i=0
  while [ "$i" -lt "$(( DC > 0 ? DC : 1 ))" ]; do
    P=$(( DS + i ))
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://$IP:$P/" 2>/dev/null || echo 000)
    echo "   GET http://$IP:$P/ -> HTTP $CODE"
    [ "$CODE" = "200" ] && echo "   ===> MAPPED PORT HIDUP: $IP:$P ==="
    i=$(( i + 1 ))
  done
fi

log "daftar instance aktif (bukti tidak ada GPU tertinggal sebelum cleanup)"
dexec 'python3 -c "
import os
from vastai import VastAI
print(\"TOTAL_INSTANCES=%d\" % len(VastAI(api_key=os.environ[\"VAST_API_KEY\"]).show_instances() or []))
"' || echo "WARN: gagal membaca daftar instance"

log "selesai — trap akan destroy instance $INSTANCE_ID"
