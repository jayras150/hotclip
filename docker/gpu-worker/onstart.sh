#!/usr/bin/env bash
# HotClip GPU Worker — ephemeral Vast.ai container entrypoint (runtime model fill).
#
# Mode A (IoC): VAST_INBOUND=1 with HOTCLIP_JOB set → boot directly into the job:
#   1. resolve source media (S3 mount / yt-dlp remote, via env),
#   2. validate MODEL env contract,
#   3. download pinned model weights into /app/models (cache volume; FAIL hard on
#      missing/corrupt weights — never run unverified weights),
#   4. launch the worker HTTP server, report `ready` to orchestrator, run pipeline,
#      POST `completed`/`failed` to the webhook.
#
# Mode B: no HOTCLIP_JOB → plain HTTP server (orchestrator POST /jobs path).
#
# Hard fail: NO_PIP_INSTALL=true / NO_APT_INSTALL=true enforced (no runtime
# modification). Model downloads ARE allowed at boot because the cache volume
# (mounted Vast.ai storage) is writable.

set -euo pipefail

MODEL_DIR="${MODEL_DIR:-/app/models}"
CHECKSUM_FILE="${CHECKSUM_FILE:-${MODEL_DIR}/integrity.checksums}"
WORKER_SERVER="/home/hotclip/src/worker/gpu-server.ts"
HTTP_PORT_NUM="${HTTP_PORT_NUM:-8080}"

# Env contract (injected by Vast.ai create_instance via buildWorkerEnv()).
CONTRACT_JOB_ID="${JOB_ID:-}"
CONTRACT_WEBHOOK="${RESULT_WEBHOOK:-}"
CONTRACT_SECRET="${VAST_WEBHOOK_SECRET:-}"
CONTRACT_RESULT_BUCKET="${RESULT_BUCKET:-}"
CONTRACT_JOB_TIMEOUT_MS="${JOB_TIMEOUT_MS:-3600000}"

# ---- Hard fail: runtime modification strictly forbidden. ----
if [ "${NO_PIP_INSTALL:-}" != "true" ]; then
  echo "FATAL: NO_PIP_INSTALL not set; refusing to pip-install at runtime" >&2
  exit 9
fi
if [ "${NO_APT_INSTALL:-}" != "true" ]; then
  echo "FATAL: NO_APT_INSTALL not set; refusing to apt-get at runtime" >&2
  exit 9
fi

# ---- Validate env contract (only meaningful in IoC mode). ----
ensure_contract() {
  if [ -z "${CONTRACT_JOB_ID}" ]; then
    echo "FATAL: JOB_ID missing in worker env contract" >&2
    exit 11
  fi
  if [ -z "${CONTRACT_WEBHOOK}" ]; then
    echo "FATAL: RESULT_WEBHOOK missing in worker env contract" >&2
    exit 11
  fi
  if [ -z "${CONTRACT_SECRET}" ]; then
    echo "FATAL: VAST_WEBHOOK_SECRET missing in worker env contract" >&2
    exit 11
  fi
  if ! [[ "${CONTRACT_JOB_TIMEOUT_MS}" =~ ^[0-9]+$ ]] || [ "${CONTRACT_JOB_TIMEOUT_MS}" -le 0 ]; then
    echo "FATAL: JOB_TIMEOUT_MS invalid: ${CONTRACT_JOB_TIMEOUT_MS}" >&2
    exit 11
  fi
  if ! [[ "${HTTP_PORT_NUM}" =~ ^[0-9]+$ ]] || [ "${HTTP_PORT_NUM}" -le 0 ] || [ "${HTTP_PORT_NUM}" -gt 65535 ]; then
    echo "FATAL: HTTP_PORT_NUM invalid: ${HTTP_PORT_NUM}" >&2
    exit 11
  fi
}

# ---- Model fill: verify existing cache, otherwise download pinned weights. ----
fill_models() {
  local manifest="${MODEL_MANIFEST:-/home/hotclip/models.manifest}"
  local need_download=1
  local actual

  if [ -f "${CHECKSUM_FILE}" ] && [ -d "${MODEL_DIR}" ] && \
     ( cd "${MODEL_DIR}" && sha256sum -c "${CHECKSUM_FILE}" >/dev/null 2>&1 ); then
    need_download=0
    echo "[onstart] integrity OK: $(ls -1 "${MODEL_DIR}" | wc -l) cached model artifact(s)"
  else
    echo "[onstart] cache incomplete or missing (${CHECKSUM_FILE}); downloading pinned models into ${MODEL_DIR}"
  fi

  if [ "${need_download}" -eq 1 ]; then
    mkdir -p "${MODEL_DIR}" || { echo "FATAL: cannot create ${MODEL_DIR}" >&2; exit 8; }
    # Clean partial/stale artifacts so the lock stays consistent.
    find "${MODEL_DIR}" -type f ! -name 'integrity.checksums' -delete 2>/dev/null || true
    if [ -f "${manifest}" ]; then
      local id url hash dest
      while IFS='|' read -r id url hash dest; do
        # Trim CR + whitespace; skip comments/blank.
        id="${id%$'\r'}"
        id="$(echo -e "${id}" | trim)"
        url="${url%$'\r'}"
        hash="${hash%$'\r'}"
        dest="${dest%$'\r'}"
        case "${id}" in ''|'#'*) continue ;; esac
        [ -n "${url}" ] && [ -n "${hash}" ] && [ -n "${dest}" ] || continue

        mkdir -p "$(dirname "${dest}")" || true
        local tmp="${dest}.part"
        rm -f "${tmp}"
        if ! curl -fL --retry 3 --retry-delay 2 --connect-timeout 30 -o "${tmp}" "${url}"; then
          echo "FATAL: download failed for ${id}: ${url}" >&2
          exit 8
        fi
        if [ "${hash}" != "AUTO" ]; then
          actual="$(sha256sum "${tmp}" | awk '{print $1}')"
          if [ "${actual}" != "${hash}" ]; then
            rm -f "${tmp}"
            echo "FATAL: sha256 mismatch for ${id}: expected ${hash}, got ${actual}" >&2
            exit 8
          fi
        fi
        mv -f "${tmp}" "${dest}"
      done < "${manifest}"
    else
      echo "FATAL: models.manifest not found: ${manifest}" >&2
      exit 8
    fi

    # Lock integrity: hash every model file, verify.
    (
      cd "${MODEL_DIR}" || exit 1
      find . -type f ! -name 'integrity.checksums' ! -name '*.part' -print0 \
        | sort -z \
        | xargs -0 -r sha256sum > "${CHECKSUM_FILE}.tmp"
      mv -f "${CHECKSUM_FILE}.tmp" "${CHECKSUM_FILE}"
      ( cd "${MODEL_DIR}" && sha256sum -c "${CHECKSUM_FILE}" ) || { echo "FATAL: post-download integrity failed" >&2; exit 8; }
    )
    echo "[onstart] done: model cache locked at ${CHECKSUM_FILE}"
  fi
}

# Minimal trim helper.
trim() {
  local s="${1}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  echo -n "${s}"
}

# ---- IoC job runner (Mode A). ----
run_job_at_boot() {
  ensure_contract

  # 1) Fill/verify model cache.
  fill_models

  # 2) Resolve source media (S3 mount or yt-dlp remote).
  local source_dir="/data/source"
  mkdir -p "${source_dir}" || { echo "FATAL: cannot create ${source_dir}" >&2; exit 7; }
  if [ -n "${SOURCE_BUCKET}" ]; then
    echo "[onstart] syncing source from S3 pool: ${SOURCE_BUCKET}"
    aws s3 sync "${SOURCE_BUCKET}" "${source_dir}" --region "${SOURCE_REGION}" --no-sign-request 2>/dev/null || true
  elif [ -n "${SOURCE_URL:-}" ]; then
    echo "[onstart] importing from remote url via yt-dlp"
    yt-dlp --no-part --no-cache-dir -o "${source_dir}/%(id)s.%(ext)s" "${SOURCE_URL}"
  fi

  local media_file=""
  for f in "${source_dir}"/*; do
    [ -e "${f}" ] || continue
    if [ -f "${f}" ]; then
      media_file="${f}"
      break
    fi
  done
  if [ -z "${media_file}" ]; then
    echo "FATAL: no source media found under ${source_dir}" >&2
    exit 7
  fi
  echo "[onstart] source: ${media_file}"

  # 3) Launch worker HTTP server (Node 22 + tsx + GPU pipeline).
  echo "[onstart] launching GPU worker server: ${WORKER_SERVER} (strategy=vast, modelDir=${MODEL_DIR})"
  exec tsx "${WORKER_SERVER}"
}

# ---- Boola: IoC (job already injected) vs plain HTTP server. ----
if [ -n "${HOTCLIP_JOB}" ]; then
  echo "[onstart] IoC mode: HOTCLIP_JOB detected; booting job ${CONTRACT_JOB_ID} directly"
  run_job_at_boot
else
  echo "[onstart] no HOTCLIP_JOB; running as plain HTTP server (orchestrator POST /jobs)"
  if command -v tsx >/dev/null 2>&1; then
    exec tsx "${WORKER_SERVER}"
  else
    echo "FATAL: tsx not found on PATH (install with `npm i -g tsx`)" >&2
    exit 5
  fi
fi
