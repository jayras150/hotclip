#!/bin/sh
# HotClip Nginx bootstrap (zero-downtime TLS activation).
#
# Starts nginx with an HTTP-only config (ACME challenge + app proxy), then
# watches /etc/letsencrypt/live/$DOMAIN/fullchain.pem. The moment certbot
# writes the certificate the config is swapped to HTTPS + 80->443 redirect and
# nginx is reloaded — no manual intervention, no crash-loop while the
# certificate is still missing.
#
# Two vhosts are rendered:
#   * the main domain ($DOMAIN) — full app
#   * the admin domain ($ADMIN_DOMAIN, default admin.hookclip.pro) — same app,
#     but restricted at the edge; /api/ and /logs/ go to the API container and
#     everything else to the web container (Next.js /admin routes).
# The admin vhost gets its HTTPS block only once its own certificate exists, so
# the script always renders a config nginx accepts (idempotent).
#
# Placeholders (`__DOMAIN__`, `__ADMIN_DOMAIN__`, ...) are substituted with sed
# at the very end so nginx's own `$host`, `$remote_addr`, ... variables are
# never expanded by the shell.
#
# POSIX sh only (runs as `sh` inside nginx:alpine / busybox ash).

set -eu

DOMAIN="${DOMAIN:-localhost}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.hookclip.pro}"
LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
ADMIN_LE_DIR="/etc/letsencrypt/live/${ADMIN_DOMAIN}"
CONF_DIR="/etc/nginx/conf.d"
CONF_FILE="${CONF_DIR}/default.conf"
CERT_FILE="${LE_DIR}/fullchain.pem"
ADMIN_CERT_FILE="${ADMIN_LE_DIR}/fullchain.pem"
WATCH_INTERVAL="${WATCH_INTERVAL:-5}"

mkdir -p "${CONF_DIR}" /var/www/certbot /var/cache/nginx

# --- building blocks -------------------------------------------------------

upstreams() {
  cat <<'NGINX'
# --- shared (dynamic DNS for api/web containers) ---------------------------
resolver 127.0.0.11 valid=10s ipv6=off;
upstream hotclip_api { zone hotclip_api 64k; server api:8080 resolve; }
upstream hotclip_web { zone hotclip_web 64k; server web:3000 resolve; }

NGINX
}

acme_location() {
  cat <<'NGINX'
  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

NGINX
}

proxy_locations() {
  cat <<'NGINX'
  location /api/ {
    proxy_pass http://hotclip_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
  }

  location /logs/ {
    proxy_pass http://hotclip_api;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
  }

  location / {
    proxy_pass http://hotclip_web;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
NGINX
}

tls_settings() {
  # $1 = placeholder for the letsencrypt live directory
  cat <<NGINX
  ssl_certificate     $1/fullchain.pem;
  ssl_certificate_key $1/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 1d;
NGINX
}

main_vhost() {
  if [ "$1" = "tls" ]; then
    cat <<'NGINX'
# --- HTTP: ACME challenge + redirect to HTTPS ------------------------------
server {
  listen 80;
  listen [::]:80;
  server_name __DOMAIN__;
  client_max_body_size 1024m;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

# --- HTTPS ----------------------------------------------------------------
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name __DOMAIN__;
  client_max_body_size 1024m;

NGINX
    tls_settings __LE_DIR__
    echo
    proxy_locations
    echo "}"
  else
    cat <<'NGINX'
# Bootstrap mode: certificate not issued yet. Serve ACME + the app over HTTP so
# the domain stays reachable while Let's Encrypt validation completes.
server {
  listen 80;
  listen [::]:80;
  server_name __DOMAIN__;
  client_max_body_size 1024m;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

NGINX
    proxy_locations
    echo "}"
  fi
}

admin_vhost() {
  if [ -f "$ADMIN_CERT_FILE" ]; then
    cat <<'NGINX'

# --- Admin vhost: __ADMIN_DOMAIN__ (HTTPS) ---------------------------------
server {
  listen 80;
  listen [::]:80;
  server_name __ADMIN_DOMAIN__;
  client_max_body_size 1024m;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name __ADMIN_DOMAIN__;
  client_max_body_size 1024m;

NGINX
    tls_settings __ADMIN_LE_DIR__
    echo
    proxy_locations
    echo "}"
  else
    # No admin certificate yet: keep ACME + the admin app reachable so the
    # bootstrap can validate the domain, and never emit an ssl server without
    # a certificate (nginx would refuse to start).
    cat <<'NGINX'

# --- Admin vhost: __ADMIN_DOMAIN__ (bootstrap, no certificate yet) ---------
server {
  listen 80;
  listen [::]:80;
  server_name __ADMIN_DOMAIN__;
  client_max_body_size 1024m;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

NGINX
    proxy_locations
    echo "}"
  fi
}

render() {
  mode="$1"
  tmp="${CONF_FILE}.tmp"

  {
    upstreams
    main_vhost "$mode"
    admin_vhost
  } | sed -e "s|__DOMAIN__|${DOMAIN}|g" \
          -e "s|__LE_DIR__|${LE_DIR}|g" \
          -e "s|__ADMIN_DOMAIN__|${ADMIN_DOMAIN}|g" \
          -e "s|__ADMIN_LE_DIR__|${ADMIN_LE_DIR}|g" \
          > "$tmp"

  mv "$tmp" "$CONF_FILE"
}

apply() {
  # Render, validate with `nginx -t`, and roll back to the previous config when
  # the freshly rendered one would not start.
  mode="$1"
  previous="$(cat "$CONF_FILE" 2>/dev/null || true)"
  render "$mode"
  if nginx -t >/dev/null 2>&1; then
    echo "[nginx-bootstrap] config applied: $mode (domain=${DOMAIN}, admin=${ADMIN_DOMAIN})"
    return 0
  fi
  echo "[nginx-bootstrap] ERROR: rendered '$mode' config failed nginx -t" >&2
  nginx -t || true
  if [ -n "$previous" ]; then
    printf '%s\n' "$previous" > "$CONF_FILE"
  fi
  return 1
}

reload() {
  nginx -s reload >/dev/null 2>&1 && echo "[nginx-bootstrap] nginx reloaded" || true
}

# Watch for certificates (initial issuance and later renewals).
watch_certificates() {
  applied_stamp=""
  admin_stamp=""
  while :; do
    if [ -f "$CERT_FILE" ]; then
      stamp="$(stat -c %Y "$CERT_FILE" 2>/dev/null || echo 0)"
      if [ "$stamp" != "$applied_stamp" ] && apply tls; then
        applied_stamp="$stamp"
        reload
      fi
    fi
    if [ -f "$ADMIN_CERT_FILE" ]; then
      stamp="$(stat -c %Y "$ADMIN_CERT_FILE" 2>/dev/null || echo 0)"
      if [ "$stamp" != "$admin_stamp" ]; then
        mode="http"
        [ -f "$CERT_FILE" ] && mode="tls"
        if apply "$mode"; then
          admin_stamp="$stamp"
          reload
        fi
      fi
    fi
    sleep "$WATCH_INTERVAL"
  done
}

# --- main ------------------------------------------------------------------

if [ -f "$CERT_FILE" ]; then
  apply tls || apply http
else
  echo "[nginx-bootstrap] no certificate at ${CERT_FILE}; starting in HTTP bootstrap mode"
  apply http
fi

watch_certificates &
echo "[nginx-bootstrap] certificate watcher started (interval ${WATCH_INTERVAL}s)"

exec nginx -g 'daemon off;'
