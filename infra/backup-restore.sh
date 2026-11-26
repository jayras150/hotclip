#!/usr/bin/env bash
#
# HotClip — encrypted backup & restore for the main VPS.
#
# Strategy:
#   backup   → stage DB dump + .env + compose file + metadata → tar
#              (best-effort) → gpg --symmetric (AES-256) → aws s3 sync to
#              s3://$BACKUP_BUCKET/backups/<timestamp>/
#   restore  → download the latest snapshot, gpg decrypt, extract into
#              TARGET_DIR, pg_restore the dump, restore .env, health-check the
#              API, chown to the hotclip user.
#
# Env vars (read from the environment):
#   BACKUP_BUCKET    S3 bucket used as the backup store   (required)
#   GPG_PASSPHRASE   Passphrase for symmetric GPG         (required)
#   GPG_KEY          Optional path to a GPG secret key to
#                    import for decryption                 (optional)
#   SOURCE_DIR       Space separated source directories to
#                    archive. Defaults to:
#                      /data/cache /data/render /data/source
#                      /data/out /app/models /home/hotclip
#   TARGET_DIR       Local staging directory for encrypted
#                    snapshots. Defaults to /mnt/backups
#   RETENTION_DAYS   Days of snapshots to keep. Defaults to 30.
#
# Usage:
#   backup-restore.sh backup
#   backup-restore.sh restore
#   backup-restore.sh cleanup
#   backup-restore.sh [backup|restore|cleanup]
#
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

HOTCLIP_USER="${HOTCLIP_USER:-hotclip}"
BACKUP_BUCKET="${BACKUP_BUCKET:-}"
GPG_PASSPHRASE="${GPG_PASSPHRASE:-}"
GPG_KEY="${GPG_KEY:-}"
SOURCE_DIR="${SOURCE_DIR:-/data/cache /data/render /data/source /data/out /app/models /home/hotclip}"
TARGET_DIR="${TARGET_DIR:-/mnt/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Postgres dump/restore target (either name is accepted).
DB_URL="${DATABASE_URL:-${DB_URL:-}}"
API_PORT="${API_PORT:-8080}"

# Repository root (this script lives in infra/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(dirname "$SCRIPT_DIR")}"

AWS_BIN="${AWS_BIN:-aws}"
AWS_REGION="${AWS_REGION:-}"

log() { echo "[backup] $*"; }
die() { echo "[backup] ERROR: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

today() { date -u +"%Y%m%dT%H%M%SZ"; }
stamp() { date +"%Y%m%d_%H%M%S"; }

import_gpg_key() {
  if [ -z "${GPG_KEY:-}" ]; then
    return 0
  fi
  if [ -f "$GPG_KEY" ]; then
    log "Importing GPG secret key from $GPG_KEY"
    gpg --batch --import "$GPG_KEY" >/dev/null 2>&1 || true
  elif [ -d "$GPG_KEY" ]; then
    log "Importing GPG secret keys from $GPG_KEY"
    gpg --batch --import "$GPG_KEY" >/dev/null 2>&1 || true
  else
    log "GPG_KEY '$GPG_KEY' not found; encrypting with passphrase only"
  fi
}

aws_login() {
  # AWS CLI v2 is assumed present. Set AWS_REGION if the bucket is in a
  # non-default region and the CLI does not already have credentials.
  if [ -n "${AWS_REGION:-}" ]; then
    export AWS_DEFAULT_REGION="$AWS_REGION"
  fi
  if ! "$AWS_BIN" sts get-caller-identity >/dev/null 2>&1; then
    die "cannot authenticate to AWS (aws cli v2 + credentials). Configure with 'aws configure' or env vars."
  fi
}

# ---------------------------------------------------------------------------
# backup — tar + gpg --symmetric, then upload via aws s3 sync
# ---------------------------------------------------------------------------
backup() {
  require_cmd "$AWS_BIN"
  require_cmd tar
  require_cmd gpg

  [ -n "$BACKUP_BUCKET" ] || die "BACKUP_BUCKET is not set"
  [ -n "$GPG_PASSPHRASE" ] || die "GPG_PASSPHRASE is not set"

  aws_login
  import_gpg_key

  # Split the source directory list (space separated).
  local src_dirs=()
  read -r -a src_dirs <<< "$SOURCE_DIR"
  if [ "${#src_dirs[@]}" -eq 0 ]; then
    die "SOURCE_DIR resolves to nothing"
  fi

  mkdir -p "$TARGET_DIR"

  local s="${stamp}"
  local archive="hotclip-backup-${s}.tar.gz"
  local arc_path="$TARGET_DIR/$archive"
  local enc_path="${arc_path}.gpg"

  # Stage out-of-band state (DB dump, .env, compose file, metadata) into a
  # `hotclip-meta/` archive member so restore can find it deterministically.
  local stage_root
  stage_root="$(mktemp -d "${TMPDIR:-/tmp}/hotclip-backup.XXXXXX")"
  local stage="$stage_root/hotclip-meta"
  mkdir -p "$stage"

  if [ -n "$DB_URL" ]; then
    if command -v pg_dump >/dev/null 2>&1; then
      log "Dumping database (pg_dump -Fc) into hotclip-meta/db.dump"
      pg_dump "$DB_URL" -Fc -f "$stage/db.dump"
    else
      log "WARNING: DATABASE_URL/DB_URL is set but pg_dump is not installed; skipping DB dump."
    fi
  else
    log "No DATABASE_URL/DB_URL set; skipping database dump."
  fi

  local f
  for f in .env docker-compose.vps.yml; do
    if [ -f "$REPO_DIR/$f" ]; then
      cp -a "$REPO_DIR/$f" "$stage/$f"
      log "Included $f"
    fi
  done

  local stage_size
  stage_size="$(du -sb "$stage" 2>/dev/null | awk '{print $1}')"
  cat > "$stage/metadata.json" <<META
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "hostname": "$(hostname)",
  "size_bytes": ${stage_size:-0},
  "database_dump": $([ -f "$stage/db.dump" ] && echo true || echo false),
  "sources": "$SOURCE_DIR"
}
META

  log "Creating archive from: ${src_dirs[*]}"
  tar --ignore-failed-read -czf "$arc_path" "${src_dirs[@]}" -C "$stage_root" hotclip-meta
  rm -rf "$stage_root"

  log "Encrypting with gpg --symmetric (AES-256)"
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$GPG_PASSPHRASE" \
    --output "$enc_path" "$arc_path"
  rm -f "$arc_path"

  local prefix="backups/${s}/"
  log "Uploading to s3://${BACKUP_BUCKET}/${prefix}"
  "$AWS_BIN" s3 sync "$TARGET_DIR" "s3://${BACKUP_BUCKET}/${prefix}" --delete --quiet

  log "Backup complete: s3://${BACKUP_BUCKET}/${prefix}${archive}.gpg"

  # Optional retention: drop snapshots older than RETENTION_DAYS.
  if [ "${RETENTION_DAYS:-0}" -gt 0 ] 2>/dev/null; then
    cleanup_old_backups
  fi
}

# ---------------------------------------------------------------------------
# restore — download the latest snapshot, decrypt, extract, chown
# ---------------------------------------------------------------------------
restore() {
  require_cmd "$AWS_BIN"
  require_cmd tar
  require_cmd gpg

  [ -n "$BACKUP_BUCKET" ] || die "BACKUP_BUCKET is not set"
  [ -n "$GPG_PASSPHRASE" ] || die "GPG_PASSPHRASE is not set"

  aws_login
  import_gpg_key

  # Find the latest snapshot (sort by the date folder + object key).
  local latest
  latest="$("$AWS_BIN" s3 ls "s3://${BACKUP_BUCKET}/backups/" --recursive | sort | tail -n 1 | awk '{print $4}')"
  if [ -z "$latest" ]; then
    die "no backups found in s3://${BACKUP_BUCKET}/backups/"
  fi

  log "Latest backup: ${latest}"

  mkdir -p "$TARGET_DIR"
  local enc_file="$TARGET_DIR/latest-backup.gpg"
  "$AWS_BIN" s3 cp "$latest" "$enc_file" --quiet

  # Decrypt into a fresh gzip archive.
  local archive="$TARGET_DIR/restored-backup.tar.gz"
  gpg --batch --yes --decrypt --passphrase "$GPG_PASSPHRASE" \
    --output "$archive" "$enc_file"
  rm -f "$enc_file"

  # Extract into TARGET_DIR (members are data/..., app/models, home/hotclip/...)
  log "Extracting into ${TARGET_DIR}"
  tar -xzf "$archive" -C "$TARGET_DIR"
  rm -f "$archive"

  # Make restored content owned by the hotclip user.
  if id "$HOTCLIP_USER" >/dev/null 2>&1; then
    chown -R "${HOTCLIP_USER}:${HOTCLIP_USER}" "$TARGET_DIR"
  fi

  # ---- Postgres restore (hotclip-meta/db.dump) ----
  local meta_dir="$TARGET_DIR/hotclip-meta"
  if [ -f "$meta_dir/db.dump" ]; then
    if [ -n "$DB_URL" ] && command -v pg_restore >/dev/null 2>&1; then
      log "Restoring database with pg_restore --clean --if-exists"
      pg_restore --clean --if-exists -d "$DB_URL" "$meta_dir/db.dump"
    else
      log "WARNING: db.dump found but DATABASE_URL/DB_URL or pg_restore is unavailable; database not restored."
    fi
  else
    log "No db.dump in snapshot; skipping database restore."
  fi

  # ---- Restore .env next to the compose file ----
  if [ -f "$meta_dir/.env" ]; then
    cp -a "$meta_dir/.env" "$REPO_DIR/.env"
    log "Restored .env -> $REPO_DIR/.env"
  fi

  # ---- Health check (retry 5x) ----
  if command -v curl >/dev/null 2>&1; then
    local health_url="http://127.0.0.1:${API_PORT}/api/health"
    local attempt healthy=false
    for attempt in 1 2 3 4 5; do
      if curl -fsS --max-time 5 "$health_url" >/dev/null 2>&1; then
        healthy=true
        break
      fi
      log "Health check attempt ${attempt}/5 failed (${health_url}); retrying in 2s..."
      sleep 2
    done
    if [ "$healthy" = "true" ]; then
      log "HEALTH OK: ${health_url} returned 200."
    else
      log "WARNING: ${health_url} did not return 200 after 5 attempts. Is the api service running?"
    fi
  else
    log "WARNING: curl not found; skipping post-restore health check."
  fi

  log "Restore complete. Recovered tree (move into place as needed):"
  ls -1 "$TARGET_DIR"
}

# ---------------------------------------------------------------------------
# cleanup — delete snapshots older than RETENTION_DAYS
# ---------------------------------------------------------------------------
cleanup_old_backups() {
  local cutoff
  cutoff="$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d)"
  # List objects, keep only those uploaded on/after $cutoff.
  "$AWS_BIN" s3 ls "s3://${BACKUP_BUCKET}/backups/" --recursive | \
    awk -v cutoff="$cutoff" '$1 < cutoff { print $4 }' | while IFS= read -r obj; do
      log "Deleting old snapshot ${obj}"
      "$AWS_BIN" s3 rm "$obj" >/dev/null
    done
}

# ---------------------------------------------------------------------------
# usage
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
usage: $0 {backup|restore|cleanup}

  backup   Create an encrypted archive of the configured source
           directories, GPG --symmetric encrypt it and sync it to
           s3://\$BACKUP_BUCKET/backups/<timestamp>/
  restore  Download the latest snapshot, decrypt and extract it into
           TARGET_DIR (chowned to ${HOTCLIP_USER}), restore the Postgres
           dump when available, and run a post-restore health check.

Environment (from the shell environment, never from a file):
  BACKUP_BUCKET   S3 bucket for the backup store (required)
  GPG_PASSPHRASE  Passphrase for symmetric GPG encryption (required)
  GPG_KEY         Optional path to a GPG secret key to import
  SOURCE_DIR      Space separated source directories to archive
  TARGET_DIR      Local staging directory for snapshots
  AWS_REGION      AWS region for the backup bucket
  RETENTION_DAYS  Snapshot retention in days (default 30)
  DATABASE_URL    Postgres connection string; enables pg_dump/pg_restore
  DB_URL          Alias of DATABASE_URL
  API_PORT        Local API port for the post-restore health check (default 8080)

Example:
  export BACKUP_BUCKET=hotclip-backups
  export GPG_PASSPHRASE='change-me'
  export GPG_KEY=~/.gnupg/private-key.gpg
  backup-restore.sh backup
EOF
}

main() {
  if [ $# -eq 0 ]; then
    usage
    exit 1
  fi

  case "$1" in
    backup) backup ;;
    restore) restore ;;
    cleanup) cleanup_old_backups ;;
    -h|--help) usage ;;
    *)
      echo "[backup] ERROR: unknown command: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
