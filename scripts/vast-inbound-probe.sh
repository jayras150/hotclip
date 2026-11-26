#!/usr/bin/env sh
# HotClip — probe Opsi 1: instance TANPA --direct, dengan `-p 8080` dan stub
# HTTP server di dalam container. Tujuannya membuktikan apakah Vast.ai
# memetakan port container ke port host yang bisa dihubungi dari luar
# (`ports` / `direct_port_start`), plus mencatat waktu boot riil.
#
# JAMINAN BIAYA: instance di-destroy lewat `trap ... EXIT` (juga INT/TERM).
#
# Pemakaian (di VPS, dari /opt/hotclip): sh scripts/vast-inbound-probe.sh

set -u

CONTAINER="${CONTAINER:-hotclip-api-1}"
PROBE_IMAGE="${PROBE_IMAGE:-python:3.12-slim}"
PROBE_DISK="${PROBE_DISK:-20}"
PROBE_PORT="${PROBE_PORT:-8080}"
READY_TIMEOUT="${READY_TIMEOUT:-300}"
POLL_SEC="${POLL_SEC:-10}"

cd "$(dirname "$0")/.." || exit 1

log() { printf '\n==> %s\n' "$*"; }
dexec() { docker exec "$CONTAINER" sh -c "$1"; }

INSTANCE_ID=""
cleanup() {
  if [ -n "$INSTANCE_ID" ]; then
    log "cleanup: destroy instance $INSTANCE_ID (hentikan billing)"
    dexec "python3 scripts/vast_manager.py release --api-key \"\$VAST_API_KEY\" --instance-id $INSTANCE_ID" \
      || echo "WARN: release gagal — destroy manual di console.vast.ai"
    INSTANCE_ID=""
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log "copy vast_manager.py terbaru ke $CONTAINER"
docker cp scripts/vast_manager.py "$CONTAINER":/app/scripts/vast_manager.py || exit 1

log "search (dph_total ascending, disk>=${PROBE_DISK}GB, inet>=400)"
dexec 'python3 scripts/vast_manager.py search --api-key "$VAST_API_KEY" --limit 20 --query "{\"dph_total\":{\"lte\":0.35},\"gpu_ram\":{\"gte\":6},\"cpu_cores_effective\":{\"gte\":2},\"disk_space\":{\"gte\":20},\"inet_down\":{\"gte\":400},\"inet_up\":{\"gte\":400},\"reliability2\":{\"gte\":0.95}}"' \
  > /tmp/hc-in-offers.json 2>/tmp/hc-in-offers.err
if [ $? -ne 0 ]; then tail -5 /tmp/hc-in-offers.err; exit 1; fi

COUNT="$(python3 -c '
import json
try: d=json.load(open("/tmp/hc-in-offers.json"))
except Exception: d=[]
print(len(d) if isinstance(d,list) else 0)')"
FIRST="$(python3 -c '
import json
try: d=json.load(open("/tmp/hc-in-offers.json"))
except Exception: d=[]
print(d[0].get("id") if isinstance(d,list) and d else "")' 2>/dev/null)"
echo "offer lolos filter: $COUNT | termurah: ${FIRST:-<tidak ada>}"
[ -n "$FIRST" ] || { echo "Tidak ada offer — probe dihentikan."; exit 0; }

log "request TANPA --direct (-p $PROBE_PORT, image=$PROBE_IMAGE, disk=${PROBE_DISK}GB, onstart stub HTTP)"
dexec "VAST_DISK_GB=$PROBE_DISK python3 scripts/vast_manager.py request \
  --api-key \"\$VAST_API_KEY\" --offer-id $FIRST --image $PROBE_IMAGE \
  --port $PROBE_PORT --onstart \"python3 -m http.server $PROBE_PORT\"" \
  > /tmp/hc-in-req.json 2>/tmp/hc-in-req.err
if [ $? -ne 0 ]; then tail -8 /tmp/hc-in-req.err; exit 1; fi

INSTANCE_ID="$(python3 -c '
import json
d=json.load(open("/tmp/hc-in-req.json"))
print(d.get("new_contract") or d.get("instance_id") or d.get("id") or "")' 2>/dev/null)"
[ -n "$INSTANCE_ID" ] || { echo "Respons tanpa id instance:"; head -c 300 /tmp/hc-in-req.json; exit 1; }
echo "INSTANCE_ID=$INSTANCE_ID (trap aktif)"

log "tunggu actual_status == running (maks ${READY_TIMEOUT}s)"
START=$(date +%s)
BOOT=""
while :; do
  ELAPSED=$(( $(date +%s) - START ))
  [ "$ELAPSED" -ge "$READY_TIMEOUT" ] && break
  dexec "python3 scripts/vast_manager.py show --api-key \"\$VAST_API_KEY\" --instance-id $INSTANCE_ID" \
    > /tmp/hc-in-show.json 2>/dev/null
  STATUS="$(python3 -c '
import json
try: d=json.load(open("/tmp/hc-in-show.json"))
except Exception: d={}
print(d.get("actual_status") or "")' 2>/dev/null)"
  printf '   t=%ss status=%s\n' "$ELAPSED" "${STATUS:-<null>}"
  if [ "$STATUS" = "running" ]; then BOOT="$ELAPSED"; break; fi
  sleep "$POLL_SEC"
done
[ -n "$BOOT" ] || { echo "TIMEOUT: belum running dalam ${READY_TIMEOUT}s"; exit 1; }

log "detail setelah running"
python3 -c '
import json
d = json.load(open("/tmp/hc-in-show.json"))
for k in ("id","actual_status","public_ipaddr","ports","direct_port_start",
          "direct_port_end","direct_port_count","image_uuid","disk_space","gpu_name","dph_total"):
    print(f"   {k:20s}= {d.get(k)}")
print("   BOOT_SECONDS        = '"$BOOT"'")'

IP="$(python3 -c 'import json;print(json.load(open("/tmp/hc-in-show.json")).get("public_ipaddr") or "")')"
DS="$(python3 -c 'import json;print(int(json.load(open("/tmp/hc-in-show.json")).get("direct_port_start") or 0))')"
PORTS_LEN="$(python3 -c 'import json;d=json.load(open("/tmp/hc-in-show.json"));print(len(d.get("ports") or {}))')"
echo "   jumlah entry ports  = $PORTS_LEN"

log "uji HTTP (port mapping Opsi 1)"
HIT=0
if [ -n "$IP" ] && [ "$DS" -gt 0 ]; then
  for P in "$DS" "$((DS+1))" "$PROBE_PORT"; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://$IP:$P/" 2>/dev/null || echo 000)
    echo "   GET http://$IP:$P/ -> HTTP $CODE"
    [ "$CODE" = "200" ] && { echo "   ===> MAPPED PORT HIDUP: $IP:$P ==="; HIT=1; }
  done
fi
if [ "$HIT" = "0" ]; then
  echo "   HASIL: tidak ada port masuk yang bisa dihubungi (direct_port_start=${DS:-n/a}, ports=${PORTS_LEN})"
  echo "   ===> OPSI 1 GAGAL: port forwarding masuk tidak tersedia"
fi

log "daftar instance aktif (sebelum cleanup)"
dexec 'python3 -c "
import os
from vastai import VastAI
print(\"TOTAL_INSTANCES=%d\" % len(VastAI(api_key=os.environ[\"VAST_API_KEY\"]).show_instances() or []))"' || echo "WARN: gagal baca daftar"

log "selesai — trap akan destroy $INSTANCE_ID"
