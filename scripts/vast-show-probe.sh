#!/usr/bin/env sh
# HotClip — probe bentuk data `show_instance` pada instance nyata.
#
# Tujuan: memastikan normalisasi `show` di scripts/vast_manager.py membaca
# `actual_status`, `public_ipaddr`, dan mapping `ports` dengan benar (pesan
# "status unknown" menandakan field tidak ditemukan).
#
# JAMINAN BIAYA: instance di-destroy lewat `trap ... EXIT`, termasuk saat
# error / diputus. Di akhir ditampilkan daftar instance aktif sebagai bukti.
#
# Pemakaian (di VPS, dari /opt/hotclip):
#   sh scripts/vast-show-probe.sh
#
# Env:
#   CONTAINER   nama container api (default hotclip-api-1)
#   PROBE_DISK  ukuran disk GB (default 60)
#   PROBE_PORT  container port yang diminta (default 8080)

set -u

CONTAINER="${CONTAINER:-hotclip-api-1}"
PROBE_DISK="${PROBE_DISK:-60}"
PROBE_PORT="${PROBE_PORT:-8080}"

cd "$(dirname "$0")/.." || exit 1

log() { printf '\n==> %s\n' "$*"; }
dexec() { docker exec "$CONTAINER" sh -c "$1"; }

INSTANCE_ID=""

cleanup() {
  if [ -n "$INSTANCE_ID" ]; then
    log "cleanup: destroy instance $INSTANCE_ID"
    dexec "python3 scripts/vast_manager.py release --api-key \"\$VAST_API_KEY\" --instance-id $INSTANCE_ID" \
      || echo "WARN: destroy gagal — cek console.vast.ai"
    INSTANCE_ID=""
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log "copy vast_manager.py terbaru ke $CONTAINER"
docker cp scripts/vast_manager.py "$CONTAINER":/app/scripts/vast_manager.py || exit 1

log "search (1 offer termurah)"
dexec 'python3 scripts/vast_manager.py search --api-key "$VAST_API_KEY" --limit 20 --query "{\"dph_total\":{\"lte\":0.35},\"gpu_ram\":{\"gte\":6},\"cpu_cores_effective\":{\"gte\":2},\"disk_space\":{\"gte\":15},\"inet_down\":{\"gte\":100},\"inet_up\":{\"gte\":100},\"reliability2\":{\"gte\":0.95}}"' \
  > /tmp/hc-offers.json 2>/tmp/hc-offers.err || { tail -5 /tmp/hc-offers.err; exit 1; }

FIRST="$(python3 -c '
import json
try: d=json.load(open("/tmp/hc-offers.json"))
except Exception: d=[]
print(d[0].get("id") if d else "")
')"
if [ -z "$FIRST" ]; then echo "Tidak ada offer lolos filter."; exit 0; fi
echo "offer=$FIRST"

log "request instance (port $PROBE_PORT, disk ${PROBE_DISK}GB)"
dexec "VAST_DISK_GB=$PROBE_DISK python3 scripts/vast_manager.py request --api-key \"\$VAST_API_KEY\" --offer-id $FIRST --port $PROBE_PORT" \
  > /tmp/hc-req.json 2>/tmp/hc-req.err || { tail -5 /tmp/hc-req.err; exit 1; }

INSTANCE_ID="$(python3 -c '
import json
d=json.load(open("/tmp/hc-req.json"))
print(d.get("new_contract") or d.get("instance_id") or "")
' 2>/dev/null)"
if [ -z "$INSTANCE_ID" ]; then echo "Respons tanpa id instance:"; head -c 400 /tmp/hc-req.json; exit 1; fi
echo "instance=$INSTANCE_ID"

i=0
while [ "$i" -lt 5 ]; do
  log "show pada t=$((i * 20))s"
  dexec "python3 - <<PY
import os, json
from vastai import VastAI
v = VastAI(api_key=os.environ['VAST_API_KEY'])
raw = v.show_instance(id=int($INSTANCE_ID))
if isinstance(raw, dict):
    print('RAW_KEYS:', sorted(raw.keys()))
    picked = {k: raw.get(k) for k in (
        'id','actual_status','cur_status','status','public_ipaddr','public_ip',
        'ports','port_mappings','ssh_host','ssh_port','gpu_name','dph_total',
    ) if k in raw}
    print('RAW_PICKED:', json.dumps(picked, default=str)[:700])
else:
    print('RAW_TYPE:', type(raw), repr(raw)[:300])
PY"
  dexec "python3 scripts/vast_manager.py show --api-key \"\$VAST_API_KEY\" --instance-id $INSTANCE_ID" \
    || echo "show via bridge GAGAL"
  i=$((i + 1))
  [ "$i" -lt 5 ] && sleep 20
done

log "daftar instance aktif (sebelum cleanup)"
dexec 'python3 - <<PY
import os
from vastai import VastAI
print("TOTAL_INSTANCES=%d" % len(VastAI(api_key=os.environ["VAST_API_KEY"]).show_instances() or []))
PY'

log "selesai (trap akan destroy instance $INSTANCE_ID)"
