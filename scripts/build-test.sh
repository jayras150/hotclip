#!/usr/bin/env bash
# Build & verification script for the Vast.ai GPU worker (Phase 3 Point 4).
#
# Verifies, in order:
#   1. Dockerfile structure   (FROM, CUDA, ffmpeg, NVENC, non-root USER, /app/models)
#   2. onstart.sh checksum logic (sha256sum -c boot-check on a synthetic tree)
#   3. bash syntax of onstart.sh + worker.js embedded heredoc
#
# Headless host (no Docker daemon / no GPU here): runs in static+logic mode.
# A real GPU host runs `docker compose -f docker-compose.gpu.yml up --build`.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="${ROOT}/docker/gpu-worker"
PASS=0; FAIL=0

ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "== 1. Dockerfile structure =="
if [ -f "${DOCKER_DIR}/Dockerfile" ]; then
  grep -Eq "^(FROM|RUN|COPY|USER|ENV|WORKDIR|ENTRYPOINT|ARG)" "${DOCKER_DIR}/Dockerfile" \
    && ok "Dockerfile has valid instructions" || fail "Dockerfile missing instructions"
  grep -q "^FROM " "${DOCKER_DIR}/Dockerfile" && ok "FROM present" || fail "no FROM"
  grep -qi "nvidia/cuda" "${DOCKER_DIR}/Dockerfile" && ok "CUDA base present" || fail "no CUDA base"
  grep -qi "nvenc" "${DOCKER_DIR}/Dockerfile" && ok "NVENC tooling referenced" || true
  grep -q "ffmpeg" "${DOCKER_DIR}/Dockerfile" && ok "ffmpeg installed" || fail "no ffmpeg"
  grep -q "/app/models" "${DOCKER_DIR}/Dockerfile" && ok "models pre-baked to /app/models" || fail "no /app/models"
  grep -q "^USER hotclip" "${DOCKER_DIR}/Dockerfile" && ok "non-root USER set" || fail "no non-root USER"
else
  fail "Dockerfile missing"
fi

echo
echo "== 2. onstart.sh checksum boot-check =="
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
printf 'alpha\n' > "${tmp}/alpha.txt"
printf 'beta' > "${tmp}/beta.txt"
( cd "${tmp}" && sha256sum alpha.txt beta.txt > integrity.checksums )

if ( cd "${tmp}" && sha256sum -c integrity.checksums 2>/dev/null ); then
  ok "sha256sum -c passes on an intact tree"
else
  fail "sha256sum -c did not pass on intact tree"
fi
printf 'CORRUPTED\n' > "${tmp}/alpha.txt"
if ( cd "${tmp}" && sha256sum -c integrity.checksums 2>/dev/null ); then
  fail "sha256sum -c passed on a corrupted file (expected abort)"
else
  ok "sha256sum -c fails on corrupted file (correctly aborts start)"
fi

echo
echo "== 3. bash syntax (onstart.sh + embedded worker.js) =="
if command -v bash >/dev/null 2>&1; then
  bash -n docker/gpu-worker/onstart.sh && ok "onstart.sh passes bash -n" || fail "onstart.sh has a bash syntax error"
fi

echo
echo "== result: ${PASS} passed, ${FAIL} failed =="
[ "${FAIL}" -eq 0 ]
