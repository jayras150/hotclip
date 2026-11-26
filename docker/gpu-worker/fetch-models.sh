#!/usr/bin/env bash
#
# HotClip GPU Worker — build-time model fetcher + integrity lock.
#
# Reads models.manifest (`id|url|sha256|dest`, one model per line), downloads
# every model into MODEL_DIR (default /app/models), verifies 64-hex hashes when
# the manifest pins them, and finally writes MODEL_DIR/integrity.checksums that
# onstart.sh verifies on every boot. Any download or hash mismatch is fatal.
#
# Usage:
#   fetch-models.sh                 # download all, then lock integrity.checksums
#   fetch-models.sh --verify-only   # verify an existing cache (no download)
#   MANIFEST=/path/models.manifest fetch-models.sh
#
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-/app/models}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${MANIFEST:-${SCRIPT_DIR}/models.manifest}"
CHECKSUMS="${MODEL_DIR}/integrity.checksums"
VERIFY_ONLY=false

usage() {
  cat <<EOF
usage: $0 [--verify-only] [manifest]

  --verify-only   Verify existing files under MODEL_DIR against the manifest
                  and integrity.checksums; never downloads or rewrites files.
  manifest        Path to models.manifest (default: ${SCRIPT_DIR}/models.manifest)

Environment:
  MODEL_DIR       Model cache root (default: /app/models)
  MANIFEST        Manifest path override
EOF
}

for arg in "$@"; do
  case "$arg" in
    --verify-only) VERIFY_ONLY=true ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [ -f "$arg" ]; then
        MANIFEST="$arg"
      else
        echo "[fetch-models] ERROR: unknown argument or missing manifest: $arg" >&2
        exit 2
      fi
      ;;
  esac
done

log() { echo "[fetch-models] $*"; }
die() { echo "[fetch-models] ERROR: $*" >&2; exit 1; }

[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

sha_of() { sha256sum "$1" | awk '{print $1}'; }

is_sha256() { [[ "$1" =~ ^[0-9a-fA-F]{64}$ ]]; }

count=0

while IFS='|' read -r id url hash dest; do
  # Trim CR (in case the manifest was checked out with CRLF) and skip noise.
  id="${id%$'\r'}"
  url="${url%$'\r'}"
  hash="${hash%$'\r'}"
  dest="${dest%$'\r'}"
  case "$id" in ''|'#'*) continue ;; esac

  [ -n "$url" ] && [ -n "$hash" ] && [ -n "$dest" ] \
    || die "malformed manifest entry for '$id' (expected id|url|sha256|dest)"

  if [ "$hash" != "AUTO" ]; then
    is_sha256 "$hash" || die "invalid sha256 for '$id': $hash (expected 64-hex or AUTO)"
    hash="$(echo "$hash" | tr 'A-F' 'a-f')"
  fi

  count=$((count + 1))

  if [ "$VERIFY_ONLY" = "true" ]; then
    [ -f "$dest" ] || die "missing model '$id' at $dest"
    if [ "$hash" != "AUTO" ]; then
      actual="$(sha_of "$dest")"
      [ "$actual" = "$hash" ] || die "sha256 mismatch for '$id' at $dest (expected $hash, got $actual)"
    fi
    log "verify OK: $id"
    continue
  fi

  mkdir -p "$(dirname "$dest")"
  log "downloading $id -> $dest"
  tmp="${dest}.part"
  rm -f "$tmp"
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 30 -o "$tmp" "$url" \
    || { rm -f "$tmp"; die "download failed for '$id': $url"; }

  if [ "$hash" != "AUTO" ]; then
    actual="$(sha_of "$tmp")"
    if [ "$actual" != "$hash" ]; then
      rm -f "$tmp"
      die "sha256 mismatch for '$id' from $url (expected $hash, got $actual)"
    fi
    log "sha256 OK: $id"
  else
    log "sha256 computed (AUTO): $id ($(sha_of "$tmp"))"
  fi

  mv -f "$tmp" "$dest"
done < "$MANIFEST"

[ "$count" -gt 0 ] || die "manifest contains no model entries: $MANIFEST"

if [ "$VERIFY_ONLY" = "true" ]; then
  [ -f "$CHECKSUMS" ] || die "missing integrity file: $CHECKSUMS"
  (cd "$MODEL_DIR" && sha256sum -c "$CHECKSUMS" >/dev/null) \
    || die "integrity.checksums verification failed under $MODEL_DIR"
  log "integrity lock OK: $CHECKSUMS"
  exit 0
fi

# Lock the final cache: hash every model file, relative to MODEL_DIR.
mkdir -p "$MODEL_DIR"
(
  cd "$MODEL_DIR"
  find . -type f ! -name 'integrity.checksums' ! -name '*.part' -print0 \
    | sort -z \
    | xargs -0 -r sha256sum > "$CHECKSUMS"
)
[ -s "$CHECKSUMS" ] || die "no model files found under $MODEL_DIR; refusing empty integrity lock"
(cd "$MODEL_DIR" && sha256sum -c "$CHECKSUMS" >/dev/null) \
  || die "post-download integrity verification failed"

log "done: $count model(s) locked in $CHECKSUMS"
