#!/usr/bin/env bash
#
# HotClip — Ubuntu 24.04 VPS provisioning script (main VPS / gaming VPS).
#
# Installs the full baseline for a HotClip production host:
#   nginx + certbot (HTTPS) · fail2ban + ufw (hardened firewall) · Docker + Compose
#   for the GPU worker · git, curl, and the tooling the CLI needs.
#
# Usage:
#   sudo bash infra/setup-vps.sh
#   bash infra/setup-vps.sh            # handled gracefully (sudo prefix)
#
# The script is safe to re-run: every step is idempotent and guarded.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Graceful sudo handling: prefix everything with sudo when not root.
# ---------------------------------------------------------------------------
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  SUDO_CMD="sudo"
else
  SUDO_CMD=""
fi

# Non-interactive install (no prompts, no tzdata dialogs).
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# Defaults (overridable via environment)
# ---------------------------------------------------------------------------
HOTCLIP_USER="${HOTCLIP_USER:-hotclip}"
SSH_KEY="${HOTCLIP_SSH_KEY:-}"          # inline public key, e.g. $(cat ~/.ssh/id_ed25519.pub)
SSH_KEY_FILE="${HOTCLIP_SSH_KEY_FILE:-}" # or a path to a public key file

log() { echo "[setup-vps] $*"; }
die() { echo "[setup-vps] ERROR: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

# ---------------------------------------------------------------------------
# 1. Package manager & required packages
# ---------------------------------------------------------------------------
log "Refreshing package lists..."
$SUDO_CMD apt-get update -y

log "Installing base packages: nginx certbot fail2ban ufw docker docker-compose-plugin git curl..."
$SUDO_CMD apt-get install -y --no-install-recommends \
  nginx \
  certbot \
  python3-certbot-nginx \
  fail2ban \
  ufw \
  docker.io \
  docker-compose-v2 \
  git \
  curl

# make sure the container runtime works
require_cmd docker

# ---------------------------------------------------------------------------
# 1b. Docker Compose v2 ONLY.
#     Ubuntu's `docker-compose` v1 binary cannot parse `dockerfile_inline`
#     and is not a CLI plugin, so `docker compose` does not exist while it is
#     installed. Remove it and guarantee the v2 plugin is present.
# ---------------------------------------------------------------------------
if ! docker compose version >/dev/null 2>&1; then
  log "Docker Compose v2 plugin missing — installing docker-compose-v2..."
  if ! $SUDO_CMD apt-get install -y --no-install-recommends docker-compose-v2 >/dev/null 2>&1; then
    mkdir -p /usr/libexec/docker/cli-plugins
    curl -fsSL \
      "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64" \
      -o /tmp/docker-compose-v2 && \
      $SUDO_CMD install -m 0755 /tmp/docker-compose-v2 /usr/libexec/docker/cli-plugins/docker-compose || true
    rm -f /tmp/docker-compose-v2
  fi
fi

if dpkg -s docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  # Legacy v1 shadows the plugin; remove the package (v2 is installed above).
  log "Removing legacy docker-compose v1 (shadows the v2 plugin)..."
  $SUDO_CMD apt-get remove -y docker-compose >/dev/null 2>&1 || true
fi

if docker compose version >/dev/null 2>&1; then
  log "Docker Compose v2: $(docker compose version --short 2>/dev/null || true)"
else
  log "WARNING: 'docker compose' plugin still unavailable."
fi

# Provide a `docker-compose` shim that forwards to the v2 plugin, so either
# spelling works in scripts (infra/backup-restore.sh, DEPLOY.md, ...).
if ! command -v docker-compose >/dev/null 2>&1; then
  printf '%s\n' '#!/bin/sh' 'exec docker compose "$@"' | $SUDO_CMD tee /usr/local/bin/docker-compose >/dev/null
  $SUDO_CMD chmod 0755 /usr/local/bin/docker-compose
fi

# ---------------------------------------------------------------------------
# 2. Firewall: allow only SSH (22), HTTP (80) and HTTPS (443)
# ---------------------------------------------------------------------------
log "Configuring ufw firewall (allow 22, 80, 443 only)..."
$SUDO_CMD ufw --force enable
$SUDO_CMD ufw allow 22/tcp comment "SSH"
$SUDO_CMD ufw allow 80/tcp comment "HTTP"
$SUDO_CMD ufw allow 443/tcp comment "HTTPS"
$SUDO_CMD ufw status verbose || true

# ---------------------------------------------------------------------------
# 3. Fail2ban (prevent brute-force on SSH)
# ---------------------------------------------------------------------------
log "Enabling fail2ban..."
$SUDO_CMD systemctl enable fail2ban --now
$SUDO_CMD systemctl status fail2ban --no-pager || true

# ---------------------------------------------------------------------------
# 3b. Fail2ban jails: sshd + nginx-http-auth
# ---------------------------------------------------------------------------
log "Writing fail2ban jails to /etc/fail2ban/jail.d/hotclip.local..."
$SUDO_CMD install -d -m 0755 /etc/fail2ban/jail.d
$SUDO_CMD tee /etc/fail2ban/jail.d/hotclip.local >/dev/null <<'JAIL'
[sshd]
enabled = true
port = ssh
filter = sshd
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5
findtime = 10m
bantime = 1h
JAIL
$SUDO_CMD systemctl restart fail2ban || true
$SUDO_CMD fail2ban-client status || true

# ---------------------------------------------------------------------------
# 3c. Lightweight log shipper (Vector) -> /var/log/hotclip/vector.log
# ---------------------------------------------------------------------------
# Sink is a local file only: no external endpoint or credential is required.
if ! command -v vector >/dev/null 2>&1; then
  # The sh.vector.dev installer prompts on /dev/tty (fails over non-interactive
  # SSH). Install the pinned release .deb directly instead — no prompts.
  VECTOR_VERSION="${VECTOR_VERSION:-0.62.0}"
  log "Installing Vector ${VECTOR_VERSION} log shipper (pinned .deb)..."
  VECTOR_DEB=""
  for candidate in \
    "https://github.com/vectordotdev/vector/releases/download/v${VECTOR_VERSION}/vector-${VECTOR_VERSION}-1-amd64.deb" \
    "https://github.com/vectordotdev/vector/releases/download/v${VECTOR_VERSION}/vector_${VECTOR_VERSION}-1_amd64.deb"; do
    if curl --proto '=https' --tlsv1.2 -fsSL "$candidate" -o /tmp/hotclip-vector.deb; then
      VECTOR_DEB="$candidate"
      break
    fi
  done
  if [ -n "$VECTOR_DEB" ] && $SUDO_CMD dpkg -i /tmp/hotclip-vector.deb >/dev/null 2>&1; then
    log "Vector installed from ${VECTOR_DEB}."
  else
    log "WARNING: Vector install failed; skipping log shipper setup."
  fi
  rm -f /tmp/hotclip-vector.deb
fi

if command -v vector >/dev/null 2>&1; then
  log "Configuring Vector (journald nginx/sshd -> file sink)..."
  $SUDO_CMD install -d -m 0755 /etc/vector /var/log/hotclip
  $SUDO_CMD tee /etc/vector/vector.yaml >/dev/null <<'VECTOR'
sources:
  journald:
    type: journald
    include_units:
      - nginx
      - ssh
      - sshd

sinks:
  hotclip_file:
    type: file
    inputs:
      - journald
    path: /var/log/hotclip/vector.log
    encoding:
      codec: json
VECTOR

  # Vector runs as the `vector` system user; make the sink directory writable.
  if id vector >/dev/null 2>&1; then
    $SUDO_CMD chown -R vector:vector /var/log/hotclip
  fi

  if $SUDO_CMD systemctl is-enabled --quiet vector >/dev/null 2>&1; then
    $SUDO_CMD systemctl restart vector || true
  else
    $SUDO_CMD systemctl enable --now vector || true
  fi
  if $SUDO_CMD systemctl is-active --quiet vector; then
    log "Vector is active (sink: /var/log/hotclip/vector.log)."
  else
    log "WARNING: Vector service is not active; check 'journalctl -u vector'."
  fi
else
  log "WARNING: vector not found; log shipper is not configured."
fi

# ---------------------------------------------------------------------------
# 4. Docker services (daemon + plugins)
# ---------------------------------------------------------------------------
log "Enabling docker daemon..."
$SUDO_CMD systemctl enable docker --now
$SUDO_CMD systemctl status docker --no-pager || true

# Allow the provisioning user to talk to docker without sudo (optional, best-effort).
if getent group docker >/dev/null 2>&1 && id "$HOTCLIP_USER" >/dev/null 2>&1; then
  $SUDO_CMD usermod -aG docker "$HOTCLIP_USER"
  log "Added '$HOTCLIP_USER' to the docker group."
fi

# ---------------------------------------------------------------------------
# 5. Host user: 'hotclip' with sudo rights
# ---------------------------------------------------------------------------
if ! id "$HOTCLIP_USER" >/dev/null 2>&1; then
  log "Creating user '$HOTCLIP_USER'..."
  $SUDO_CMD useradd -m -s /bin/bash -U "$HOTCLIP_USER"
fi

$SUDO_CMD usermod -aG sudo "$HOTCLIP_USER"
log "Gave '$HOTCLIP_USER' sudo rights."

# Optional: install an SSH authorized key (non-interactive; skip if no key provided).
if [ -n "$SSH_KEY_FILE" ] && [ -r "$SSH_KEY_FILE" ]; then
  SSH_KEY="$(cat "$SSH_KEY_FILE")"
elif [ -n "$SSH_KEY" ]; then
  SSH_KEY="$SSH_KEY"
fi

if [ -n "$SSH_KEY" ]; then
  log "Installing SSH authorized key for '$HOTCLIP_USER'..."
  mkdir -p "/home/$HOTCLIP_USER/.ssh"
  $SUDO_CMD sh -c "echo '$SSH_KEY' >> /home/$HOTCLIP_USER/.ssh/authorized_keys"
  $SUDO_CMD chown -R "$HOTCLIP_USER:$HOTCLIP_USER" "/home/$HOTCLIP_USER/.ssh"
  $SUDO_CMD chmod 700 "/home/$HOTCLIP_USER/.ssh"
  $SUDO_CMD chmod 600 "/home/$HOTCLIP_USER/.ssh/authorized_keys"
fi

# ---------------------------------------------------------------------------
# 6. Readiness checks
# ---------------------------------------------------------------------------
for svc in docker fail2ban nginx; do
  if ! $SUDO_CMD systemctl is-enabled "$svc" >/dev/null 2>&1; then
    log "WARNING: $svc is not enabled at boot."
  fi
done

# UFW is enabled above; make sure nothing extra slips through.
$SUDO_CMD ufw --force enable >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log ""
log "VPS ready. Next: infra/backup-restore.sh or DEPLOY.md"
log "User '$HOTCLIP_USER' can now be used to deploy the main VPS."
log "NOTE: log out and back in (or run 'newgrp docker') so '$HOTCLIP_USER' picks up the docker group."
log "Logs: fail2ban jails in /etc/fail2ban/jail.d/hotclip.local, Vector sink /var/log/hotclip/vector.log."
