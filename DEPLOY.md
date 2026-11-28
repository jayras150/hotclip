# HotClip — Deploying the Main VPS

End-to-end deployment for a HotClip production server (Ubuntu 24.04): the Node
HTTP API (`src/server/`), the Next.js web app (`web/`), nginx + Let's Encrypt,
encrypted backups, and the pre-baked GPU worker image for Vast.ai.

```
                    Internet
                       |
               Cloudflare DNS (A record)
                       |
        +--------------+--------------+
        |        nginx :80/:443       |
        |   /api,/logs -> api:8080    |
        |   /          -> web:3000    |
        +--------------+--------------+
                       |
        +--------------+--------------+
        |  api (tsx)   |  web (Next)  |
        +--------------+--------------+
                       |
              DATABASE_URL (Postgres)

GPU jobs: main VPS -> Vast.ai -> hotclip-gpu-worker image
          (models pre-baked at image build, verified on boot)
```

> The web app is a standalone Next.js application in `web/`; the backend is the
> Node HTTP API in `src/server/` (built-in `http` module, run with `tsx`).

---

## Prerequisites

| Where | Tool | Purpose |
| --- | --- | --- |
| Local | `docker` + `docker compose` v2.23+ | Build/run services, `dockerfile_inline` |
| Local | `pnpm` | Workspace installs / tests |
| Local | `ssh`, `git` | Provision and clone |
| VPS | (installed by `infra/setup-vps.sh`) | nginx, certbot, fail2ban, ufw, docker |
| VPS | `aws cli v2`, `gpg`, `pg_dump`/`pg_restore` | Backups + DB snapshots |
| VPS | `curl` | Health checks |

`pg_dump` / `pg_restore` live in `postgresql-client`:

```bash
sudo apt-get install -y postgresql-client
```

---

## 1. Provision the VPS

On the fresh Ubuntu 24.04 host:

```bash
# From your local machine:
ssh root@<VPS_IP> "bash -s" < infra/setup-vps.sh
```

Or after connecting:

```bash
sudo bash /opt/hotclip/infra/setup-vps.sh
```

The script is idempotent and installs/does:

- `nginx`, `certbot`, `python3-certbot-nginx`, `fail2ban`, `ufw`,
  `docker.io`, `docker-compose-v2`, `git`, `curl`
- **Docker Compose v2 only**: Ubuntu's legacy `docker-compose` v1 binary has no
  `dockerfile_inline` support and is not a CLI plugin, so it is removed when it
  would shadow `docker compose`. A `/usr/local/bin/docker-compose` shim is
  installed that forwards to the v2 plugin, so both spellings work.
- `ufw` allowing **only** `22/tcp`, `80/tcp`, `443/tcp`
- fail2ban jails in `/etc/fail2ban/jail.d/hotclip.local`
  (`sshd` + `nginx-http-auth`)
- **Vector** log shipper (pinned `.deb` release — the `sh.vector.dev`
  installer prompts on `/dev/tty` and fails over non-interactive SSH), journald units
  `nginx`/`ssh`/`sshd` → local file sink `/var/log/hotclip/vector.log`
  (no external endpoint, no credentials)
- a `hotclip` user with sudo rights, optionally an SSH key
  (`HOTCLIP_SSH_KEY` / `HOTCLIP_SSH_KEY_FILE`)

End of output:

```
VPS ready. Next: infra/backup-restore.sh or DEPLOY.md
```

**Re-login required:** the `hotclip` user is added to the `docker` group, which
only takes effect in a new session. Log out and back in (or run `newgrp docker`)
before running `docker ...` without `sudo`.

---

## 2. Clone the repository and configure `.env`

```bash
ssh hotclip@<VPS_IP>
sudo mkdir -p /opt/hotclip && sudo chown hotclip:hotclip /opt/hotclip
git clone https://github.com/xixihhhh/hotclip.git /opt/hotclip
cd /opt/hotclip
git checkout <release-tag>

cp .env.example .env
chmod 600 .env
```

Edit `.env`. Never commit it. Minimum set for the VPS compose stack:

| Variable | Description |
| --- | --- |
| `HOST` | API bind address (`0.0.0.0` inside the container) |
| `PORT` | API port (`8080`; compose pins it to 8080 internally) |
| `AUTH_TOKEN` | Bearer token for `/api/v1/*`. `/api/admin/*` is **not** reachable with this token — it needs a Clerk admin session (see `ADMIN_*` below) |
| `DATABASE_URL` | Postgres connection string (`postgresql://…`) |
| `VAST_API_KEY` | Vast.ai API key |
| `VAST_WEBHOOK_SECRET` | Webhook signature secret |
| `WORKER_WEBHOOK_BASE_URL` | Public worker URL used by Vast.ai callbacks |
| `RESULT_BUCKET` | S3-compatible result bucket |
| `NEXT_PUBLIC_API_URL` | **Public** web origin baked into the build, e.g. `https://app.example.com` (leave empty to call the web origin itself; the API is not reachable at a separate host) |
| `DOMAIN` | Public hostname for nginx TLS, e.g. `app.example.com` |
| `BACKUP_BUCKET` | S3 bucket for encrypted snapshots |
| `GPG_PASSPHRASE` | Backup encryption passphrase (keep out of git) |
| `AWS_REGION` | Region of `BACKUP_BUCKET` |
| `CLERK_SECRET_KEY` | Clerk secret key. **Required** for `/api/admin/*`: the console authenticates with a Clerk session token, verified server-side |
| `ADMIN_CLERK_USER_IDS` | CSV of Clerk user IDs allowed into the admin console |
| `ADMIN_EMAILS` | CSV of admin emails (secondary allowlist, matched against the Clerk session) |
| `ADMIN_2FA_SECRET` | **Do not set yet.** No endpoint issues the `x-admin-2fa` cookie, so enabling it locks every admin request out with a 401 |
| `ADMIN_ALLOWED_IPS` | Optional CSV of IPs allowed into the admin console (layer 4; checked against the socket address) |

Optional compose overrides: `API_PORT` (host loopback port, default `8080`),
`WEB_PORT` (host loopback port, default `3000`).

> `NEXT_PUBLIC_API_URL` is a **build-time** value in Next.js. Changing it requires
> `docker compose -f docker-compose.vps.yml build web`.

---

## 3. Cloudflare DNS

In the Cloudflare dashboard for your zone, add:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| `A` | `app` (or `@`) | `<VPS_IP>` | DNS-only for the first certificate, then proxied |
| `CNAME` | `www` | `app.example.com` | same |

Notes:

- Let's Encrypt HTTP-01 validation needs port 80 reachable. If Cloudflare proxying
  is on (orange cloud), ensure SSL/TLS mode is **Full (strict)** after certbot has
  issued the origin certificate; during issuance either set the record to
  DNS-only or allow the ACME challenge path through.
- Keep `80/tcp` and `443/tcp` open in `ufw` (the provisioning script already does).

---

## 4. Start the production stack

`docker-compose.vps.yml` defines:

| Service | Purpose | Exposure |
| --- | --- | --- |
| `api` | `tsx src/server/index.ts`, env from `.env` | `127.0.0.1:8080` + healthcheck `GET /api/health` |
| `web` | Next.js build/start | `127.0.0.1:3000` |
| `nginx` | reverse proxy + TLS | `80`, `443` |
| `certbot` | optional profile, renewal loop | — |
| `watchtower` | auto-update, label-enabled, 1h interval | — |
| `redis` | optional profile (`queue`) | internal only |

```bash
cd /opt/hotclip
docker compose -f docker-compose.vps.yml up -d --build
docker compose -f docker-compose.vps.yml ps
```

Verify the API health endpoint (must return `200 OK` / `{"ok":true}`):

```bash
curl -fsS http://127.0.0.1:8080/api/health && echo " <- api OK"
docker compose -f docker-compose.vps.yml exec api \
  node -e "fetch('http://127.0.0.1:8080/api/health').then(async r=>{console.log(r.status, await r.text());process.exit(r.ok?0:1)})"
```

Start optional services:

```bash
# Redis queue/cache (opt-in)
docker compose -f docker-compose.vps.yml --profile queue up -d redis

# Watchtower is part of the default stack (auto-updates label-enabled services).
```

The nginx service generates its config inline. `/api/` and `/logs/` proxy to the
API, everything else to the web app. A TLS server block is added automatically
when `/etc/letsencrypt/live/$DOMAIN/fullchain.pem` exists.

---

## 5. TLS with Certbot

The `certbot` service is behind the `certbot` profile. Issue the first
certificate with the webroot challenge served by nginx:

```bash
cd /opt/hotclip
export DOMAIN=app.example.com
export LE_EMAIL=admin@example.com

docker compose -f docker-compose.vps.yml --profile certbot run --rm \
  --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$LE_EMAIL" \
  --agree-tos --no-eff-email

# Recreate nginx so it picks up the TLS block.
docker compose -f docker-compose.vps.yml up -d nginx
```

Then start the renewal loop (normally daily checks; renews when <30 days left):

```bash
docker compose -f docker-compose.vps.yml --profile certbot up -d certbot
```

Verify HTTPS end-to-end:

```bash
curl -fsS "https://${DOMAIN}/api/health" && echo " <- TLS health OK"
sudo certbot renew --dry-run   # optional: host-level check if certbot is installed
```

---

## 6. GPU worker image (Vast.ai)

The GPU worker is built from `docker/gpu-worker/Dockerfile`. Model weights are
**downloaded at image build time** by `docker/gpu-worker/fetch-models.sh` from
the pinned manifest `docker/gpu-worker/models.manifest`
(`id|url|sha256|dest`); `AUTO` hashes are computed and locked into
`/app/models/integrity.checksums` during the build. `onstart.sh` never downloads
anything and hard-fails if `integrity.checksums` is missing or any hash mismatches.

The manifest pins real URLs for:

| id | Model | Destination |
| --- | --- | --- |
| `whisper` | whisper.cpp GGML `base.en` (pinned revision) | `/app/models/whisper/ggml-base.en.bin` |
| `yunet` | OpenCV Zoo YuNet face detector | `/app/models/yunet.onnx` |
| `ferplus` | FER+ emotion recognition | `/app/models/ferplus.onnx` |
| `transnetv2` | TransNetV2 shot detection (pinned HF revision) | `/app/models/transnetv2.onnx` |
| `vad` | Silero VAD (tag `v5.1.2`) | `/app/models/silero_vad.onnx` |
| `subfont` | Noto Sans Regular | `/app/models/subfont/NotoSans-Regular.ttf` |

Build (the context is the repository root; the model downloads happen in the
builder stage):

```bash
cd /opt/hotclip
docker build \
  --build-arg MODEL_MANIFEST=docker/gpu-worker/models.manifest \
  -t hotclip-gpu-worker:latest \
  -f docker/gpu-worker/Dockerfile .
```

Validate a model cache without downloading (`MODEL_DIR` must contain the files
and `integrity.checksums`):

```bash
MODEL_DIR=/app/models bash docker/gpu-worker/fetch-models.sh --verify-only
```

Local GPU verification (host needs `nvidia-container-toolkit`):

```bash
docker compose -f docker-compose.gpu.yml up -d
docker compose -f docker-compose.gpu.yml ps
docker logs -f hotclip-gpu-worker
```

On Vast.ai the image is booted on demand with `NO_PIP_INSTALL=true` and
`NO_APT_INSTALL=true` (already enforced by `onstart.sh`); the container is
ephemeral, so no state is stored inside it.

---

## 7. Database migrations

```bash
cd /opt/hotclip
export DB_URL="postgresql://…"
supabase db push --db-url "$DB_URL"
```

Migrations in `supabase/migrations/`:

```text
migrations/0001_tenant_schema.sql
migrations/0002_vast_and_security.sql
```

Verify:

```bash
supabase db list
supabase migrations list
```

---

## 8. Backups and restore

`infra/backup-restore.sh` is the single source of truth:

- `backup` — `pg_dump -Fc` (when `DATABASE_URL`/`DB_URL` is set), copies `.env`
  and `docker-compose.vps.yml`, writes `hotclip-meta/metadata.json`
  (timestamp, hostname, size), tars everything, encrypts with `gpg --symmetric`
  (AES-256), uploads to `s3://$BACKUP_BUCKET/backups/<timestamp>/`.
- `restore` — downloads the latest snapshot, decrypts, extracts, runs
  `pg_restore --clean --if-exists` when `db.dump` is present, restores `.env`,
  then checks `GET http://127.0.0.1:${API_PORT:-8080}/api/health` (5 retries).
- `cleanup` — deletes snapshots older than `RETENTION_DAYS`.

Manual run:

```bash
cd /opt/hotclip
set -a; . ./.env; set +a          # loads DATABASE_URL, BACKUP_BUCKET, GPG_PASSPHRASE, ...
export RETENTION_DAYS=30

./infra/backup-restore.sh backup
./infra/backup-restore.sh restore
./infra/backup-restore.sh cleanup
```

`pg_dump`/`pg_restore` are optional: if missing, the script logs a warning and
continues with the file backup (the DB is skipped).

### Scheduled backup (cron, as the `hotclip` user)

```cron
# /etc/cron.d/hotclip-backup  (root-owned, mode 0644)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * hotclip cd /opt/hotclip && set -a && . ./.env && set +a && ./infra/backup-restore.sh backup >> /var/log/hotclip/backup.log 2>&1
```

Ensure `/var/log/hotclip` exists and is writable by `hotclip`, and that AWS
credentials are available to the cron environment (env file, `~/.aws/credentials`,
or an instance profile).

---

## 9. Monitoring

```bash
docker compose -f docker-compose.vps.yml ps
docker compose -f docker-compose.vps.yml logs -f api web nginx
curl -fsS http://127.0.0.1:8080/api/health          # 200 + {"ok":true}
curl -fsS "https://${DOMAIN}/api/health"            # through nginx + TLS
sudo fail2ban-client status sshd
sudo fail2ban-client status nginx-http-auth
sudo tail -f /var/log/hotclip/vector.log            # Vector file sink
```

GPU worker (local / Vast.ai):

```bash
docker logs -f hotclip-gpu-worker     # expect "[onstart] integrity OK: ..."
```

---

## 10. Troubleshooting

### `docker: permission denied while trying to connect to the Docker daemon`
The `docker` group membership is only applied to new sessions. Log out/in or run
`newgrp docker`.

### `dockerfile_inline` / `additional property ... is not allowed`
The VPS needs Docker Compose **v2.23+** for inline Dockerfiles. Upgrade:

```bash
sudo apt-get install -y docker-compose-plugin
docker compose version
```

### `nginx` exits because `fullchain.pem` is missing
TLS is only enabled after certbot has issued a certificate. Run step 5 first,
then `docker compose -f docker-compose.vps.yml restart nginx`. HTTP (`:80`)
works before issuance.

### `GET /api/health` is not 200
Check `docker compose -f docker-compose.vps.yml logs api`; the API must be able to
reach Postgres (`DATABASE_URL`) and bind `PORT=8080`. The web service depends on
the API being healthy, so it will stay down until this passes.

### `next build` baked the wrong API URL
`NEXT_PUBLIC_API_URL` is build-time. Set the public HTTPS URL and rebuild:
`docker compose -f docker-compose.vps.yml build web && docker compose -f docker-compose.vps.yml up -d web`.

### Backup script: `required command not found: pg_dump`
Install `postgresql-client` or run without a DB URL (the file backup still works).

### Backup script: `cannot authenticate to AWS`
Configure AWS CLI v2 credentials (`aws configure`, env vars, or an instance
profile) for the user running the cron job.

### Restore health check warns `did not return 200 after 5 attempts`
The API container is not running yet (or migrated DB is unreachable). Start the
stack with `docker compose -f docker-compose.vps.yml up -d`, wait for the api
healthcheck, then re-run the check.

### Vector service is not active
Inspect `journalctl -u vector`. The config is `/etc/vector/vector.yaml`; the sink
directory `/var/log/hotclip` must be writable by the `vector` user.

### fail2ban has no `nginx-http-auth` jail
Confirm `/etc/fail2ban/jail.d/hotclip.local` exists and restart:
`sudo systemctl restart fail2ban && sudo fail2ban-client status`.

### GPU worker exits immediately
`docker logs hotclip-gpu-worker`; common causes:

- missing NVIDIA container toolkit (the image targets NVENC)
- `/app/models/integrity.checksums` missing or hash mismatch (exit `8`)
- a model URL in `models.manifest` changed; rebuild the image
- `tsx`/worker server not mounted when using the local `docker-compose.gpu.yml`

### `fetch-models.sh` fails during `docker build`
The manifest URL is unreachable or pinned to a removed revision. Test it with
`curl -fL <url> -o /dev/null`, update the manifest, rebuild. Pinned revisions
(Whisper commit, TransNetV2 HF revision, Silero tag `v5.1.2`) are intentional.

### `certbot` cannot validate `/.well-known/acme-challenge/`
Port 80 must reach the `nginx` container and the challenge location must resolve
to `/var/www/certbot` (already configured). With Cloudflare proxying, allow the
ACME path or switch the record to DNS-only during issuance.

---

## Quick reference

```bash
# Provision (idempotent)
ssh root@<VPS> "bash -s" < infra/setup-vps.sh

# Production stack
cd /opt/hotclip && cp .env.example .env
docker compose -f docker-compose.vps.yml up -d --build
curl -fsS http://127.0.0.1:8080/api/health          # 200 OK

# TLS
docker compose -f docker-compose.vps.yml --profile certbot run --rm \
  --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$LE_EMAIL" --agree-tos --no-eff-email
docker compose -f docker-compose.vps.yml up -d nginx
docker compose -f docker-compose.vps.yml --profile certbot up -d certbot

# GPU worker image (models pre-baked + checksum locked)
docker build --build-arg MODEL_MANIFEST=docker/gpu-worker/models.manifest \
  -t hotclip-gpu-worker:latest -f docker/gpu-worker/Dockerfile .
docker compose -f docker-compose.gpu.yml up -d

# Migrations
supabase db push --db-url "$DATABASE_URL"

# Backups (cron: daily 03:00)
set -a; . ./.env; set +a
./infra/backup-restore.sh backup | restore | cleanup
```
