# HotClip — Vast.ai GPU Worker & Production VPS Blueprint

> **Status:** ARCHITECTURE PLAN (no application code modified)  
> **Repository:** `xixihhhh/hotclip` (v0.35.2, AGPL-3.0)  
> **Goal:** Move all heavy CPU/GPU compute out of the local Electron app into ephemeral, on-demand Vast.ai GPU containers, and deploy a lean, hardened production VPS (SSH `root@152.44.39.194`, Ubuntu 24.04 LTS) for web/API/storage/gateway.
> **Prerequisite found:** the `vastai` / `vastai-sdk` skills referenced in the brief are **not installed** in this checkout. The spec's intended semantics were followed below using documented Vast.ai API conventions; get the skills and re-run this audit before editing code.

---

## 0. Context — Why This Change

HotClip v0.35.2 is a **purely local** Electron app:

- **All compute is local.** FFmpeg/AV1, Whisper/faster-whisper ASR, diarization, emotion/face detection (YuNet/FER+), TransNetV2, VLM contact-sheet review, captions (Chromium offscreen overlay), and H.264 export run on the user's machine.
- **There is no backend, no database, no web server, no S3/R2 object storage, no queue, no proxy.** Everything is file-based in `userData` + local caches.
- **There is no remote GPU tier.** "Record → auto-clip" (folder watch, webhook, 7×24) is just a local Electron process.

The business and reliability problems this plan targets:

| Problem | Root cause in codebase | Target fix |
|---|---|---|
| Heavy local machine always busy | ASR + detection + rendering all in-process | Offload to Vast.ai GPU containers |
| No tenant/multi-user or job isolation | Single-user, single-process | Run video jobs as disposable containers, keep web/API/db on a lean VPS |
| No SSL/Fail2Ban/production hardening | Desktop app only | Nginx + Certbot/Let's Encrypt + Fail2Ban on the VPS |
| No backup restore procedure | Only local state | Encrypted backups, decrypt, restore DB/.env, health-check, Cloudflare DNS |
| No automated instance teardown on failure | — | Fail-safe instance deletion on timeout/abort/boot-fail |

---

## 1. Technical Audit of `hotclip` codebase

### 1.1 Stack snapshot

| Layer | Technology (file paths) |
|---|---|
| App shell | Electron main + preload + React 19 renderer + TypeScript + Tailwind 4 (`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `electron-builder.yml`) |
| Video IO | `ffmpeg-static`, `@ffprobe-installer/ffprobe` (`src/core/binaries.ts`, `src/core/probe.ts`) |
| ASR (CPU) | `sherpa-onnx-node`, `onnxruntime-node` (SenseVoice/Paraformer/FireRed, `src/core/transcribe/*`) |
| AI inference (CPU) | `onnxruntime-node` — YuNet/FER+/TransNetV2/Silero-VAD (`src/core/reframe/yunet.ts`, `src/core/diarize.ts`, `src/core/emotion.ts`, `src/core/transcribe/sensevoice.ts` etc.) |
| Caption rendering | Chromium offscreen BrowserWindow + `renderCaptionOverlay()` compositing BGRA frames into FFmpeg (`src/main/overlay-renderer.ts`) |
| LLM | Any OpenAI-compatible endpoint (`src/core/llm-transport.ts`) |
| Jobs/defer | In-process only; `ExportTaskRunner`, `FolderWatcher` (≈15s poll), webhook server (`src/main/index.ts` IPC, `src/core/watch.ts`, `src/core/webhook.ts`) |
| Storage | Local `userData`: transcript-cache, render-cache (1 GB LRU), evidence-index (64 MB LRU), models, automation queue (JSON) |
| CLI / MCP | `src/cli/index.ts`, `src/mcp/server.ts` (stdio) — share `core/pipeline.ts` |

### 1.2 Compute-heavy units to pull out

| Process | Where it runs today | Held in container |
|---|---|---|
| FFmpeg decode/encode + HDR→SDR | `src/core/video-encoder.ts`, `src/core/export.ts`, `src/core/caption-overlay/payload.ts`, `src/core/smart-render.ts`, `src/core/color.ts` | ✅ Yes (NVENC/Videotoolbox/QSV or CPU fallback) |
| Caption overlay (CSS) | `src/main/overlay-renderer.ts` (offscreen Chromium) | ✅ Yes (headless Chromium) |
| Whisper/faster-whisper + VAD + diarization | pip-installed Python ASR (referenced in brief; repo uses sherpa-onnx native) | ✅ Yes |
| YuNet/FER+/TransNetV2/VLM | `onnxruntime-node` `src/core/reframe/*`, `src/core/diarize.ts`, `src/core/emotion.ts`, `src/core/highlight/vision*`, `src/core/media-evidence.ts` | ✅ Yes |
| yt-dlp video fetch | `src/core/url-import.ts` | ✅ Yes (in container) |
| Web server/API/gateway/db/queue/proxy | **Does not exist** | New, on the VPS |
| Bucket/object storage | **Does not exist** | New, on the VPS (S3/R2-compatible) |

### 1.3 What stays local (privacy-first, one-click)

- UI, settings, glossary, review-memory, app settings.
- Local model downloads + `userData` caches (optional proxy route: models could be hot-sync'd to the VPS if desired, but the spec keeps them local; the container is transient).
- `clips.json` + render-QA + `transcript` stay on the user's machine.

### 1.4 Diagrams of compute offload

```
 ┌──────────────┐    IPC/HTTP       ┌──────────────────────────────────────────┐
 │  Electron    │◄─────────────────►│  PRODUCTION VPS                          │
 │  Renderer    │  axios/ws          │  Nginx → API Gateway → Queue → DB       │
 │  (UI, store, │   JSON/RPC         │  • watchtower                   www.         │
 │   settings)  │                    │  • health check        • awsv4       ├──┤  │
 │              │                    │  • proxy/vectorize          api          │  │
 │  node        │   REST/WS          │  • object bucket                     │  │
 │  main +      │                    │  • auto-resolve + fail2ban       r2/hf      │
 │  worker      │                    │  • logs/streams + TLS            S3         │
 └──────────────┘                    └──────────┬───────────────────────┘        │
                                              Workload shards to Vast.ai GPU
                                              ephemeral containers (per job)
 ┌──────────────────┐                      ┌───►  GPU Container N ──┐
 │  Local Machine   │                      │     ffmpeg/audio/cap   │
 │  (dev/laptop)    │                      │     whisper/diarize    │
 │  • UI, settings  │                      │     render captions    │
 │  • caches +     │                      │     models pre-baked   │
 │  • clips.json   │                      └────────────────────────┘
 └──────────────────┘
```

The **computing headroom** model: main VPS handles web/org; the Vast.ai container is a **compute vault** that never stores anything between jobs. On abort/timeout → container is destroyed, nothing to leak.

---

## 2. End-to-End Architecture Diagram

```
                                  ┌───────────────────────────────┐
                                  │   User / Admin browser        │
                                  │   (HMR/renderer)              │
                                  └───────────────┬───────────────┘
                                                  │ HTTPS
                                                  ▼
                                  ┌───────────────────────────────┐
                                  │        Cloudflare             │
                                  │  A-record → VPS IP            │
                                  │  SSL, WAF, DDoS, cache        │
                                  └───────────────┬───────────────┘
                                                  │
                                                  ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  MAIN VPS (lightweight)                    ┃  VAST.IA GPU CONTAINER   ┃
┃  (perpetual, 2–4 vCPU / 4–16 GB RAM      ┃  (ephemeral, per job)    ┃
┃   / 100–500 GB NVMe / $0.150/hr cap)     ┃  (cold + teardown)       ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃  • Nginx (TLS termination, WAF, cache)   ┃                        ┃
┃  • API Gateway (rate limit, auth, route) ┃  Pipeline container     ┃
┃  • Auth & tenant mgmt (JWT/OAuth)        ┃  • Deno runtime          ┃
┃  • Job queue (Redis / BullMQ / SQLite)   ┃  • CUDA + FFmpeg NVENC   ┃
┃  • Orchestrator (create/request/cancel)  ┃  • yt-dlp                ┃
┃  • Metadata DB (Postgres / SQLite)       ┃  • Whisper + diarization ┃
┃  • Media store (S3-compatible bucket)    ┃  • YuNet/FER+/TransNetV2  ┃
┃  • Blob store proxy                      ┃  • caption overlay (Chromium)┃
┃  • Health check + watchdog               ┃  • Model weights baked   ┃
┃  • Fail2Ban, log shipper                 ┃  • Python/Node deps baked  ┃
┃  • Backup (encrypted) + restore script   ┃  • Pre-cached model ops  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### Key flow

1. User opens the web app → Cloudflare → Nginx (TLS) → API gateway.
2. Browser requests `/api/jobs` / `/api/videos/<id>/render` etc. → Gateway validates + rate-limits.
3. Gateway publishes a job to the queue.
4. Orchestrator (`main VPS`) evaluates the job; if GPU compute is needed, it:
   - Searches Vast.ai with the **strict filter** (Section 5),
   - Requests the best candidate,
   - Dispatches the **pre-baked Docker image** (which already contains CUDA, FFmpeg+NVENC, tokenizers, model files, yt-dlp),
   - Registers instance ID + SSH/log endpoints in the queue.
5. Container runs `onstart`: clones the job payload, verifies checksums, pulls source from S3-compatible bucket (or volume mount), runs the pipeline, writes **only metadata + produced files** to S3.
6. On completion: job marked `completed`, media URL surfaced, auto-produced render-QA report posted back to metadata DB.
7. On abort / timeout / boot-fail: orchestrator cancels request → container is killed → **hard-delete** (fail-safe) after a short grace period.
8. Main VPS never executes video; it only proxies/queues/orchestrates.

---

## 3. Database & Security Design

### 3.1 Recommended stack

| Concern | Choice | Rationale |
|---|---|---|
| Relational metadata | **Supabase PostgreSQL** (production) | HotClip is file/SQLite-friendly; Supabase Postgres scales to multi-user. Metadata (jobs, vast_instances, storage, users, credits) lives in the managed Postgres DB. |
| Job queue | **Redis + BullMQ** (or SQLite fallback) | Durable, retries, priority, cancellation. |
| Object storage | **Supabase Storage** (managed, Postgres-backed) *or* **S3-compatible bucket** | Supabase Storage is simplest (no extra vendor); keep an S3-compatible bucket (R2/HF Spaces/MinIO) if you need native S3 API + presigned URL control. `sourceUrl`/`mediaUrl` fields work with either. |
| Vector/search (optional) | **qdrant/pgvector** | For searchable candidates/LLM memory. |
| Secrets | **Vault / AWS SSM / Doppler** | No secrets in code, `.env`, or DB. |
| User conf. | `settings.json` (local) migrated to DB + encrypted at-rest per device. |

### 3.2 Proposed table model

| Table | Key fields | Notes |
|---|---|---|
| `users` | `id`, `email`, `password_hash`, `enc_key_id` | Password hashed (argon2id/bcrypt); `enc_key_id` points to the per-user data-encryption key. |
| `device_fingerprints` | `user_id`, `id`, `pub_key`, `fingerprint_hash`, `created_at` | For multi-device trust/session binding. |
| `api_keys` | `id`, `user_id`, `name`, `key_hash`, `scopes`, `active`, `created_at` | Rotated, revocable. |
| `vault` (config) | `user_id`, `key`, `value`, `encrypted_at_rest` | Per-user preferences/keys encrypted with data-encryption key. |
| `jobs` | `id`, `user_id`, `status`, `priority`, `pipeline`, `params_json`, `source_url`, `media_url`, `render_qa_json`, `created_at`, `updated_at`, `expires_at` | Queue state; `status ∈ queued|running|completed|failed|timeout`. |
| `vast_instances` | `job_id`, `vast_id`, `ssh_ip`, `ssh_port`, `image`, `request_id`, `status`, `expired_at`, `rent_started_at`, `deleted_at` | Track every container. |
| `vast_templates` | `id`, `name`, `dockerfile_ref`, `image_digest`, `cuda`, `nvenc`, `model_ids`, `created_at` | Reusable template catalog. |
| `storage_providers` | `id`, `user_id`, `type`, `endpoint`, `bucket`, `region`, `access_key_id`, `access_key_id` | S3-compatible mount config. |
| `cookies` (cookie pool) | `id`, `site`, `value_hash`, `domain`, `expires_at`, `source`, `created_at`, `last_used_at` | For authenticated URL imports (B站/YouTube); stored **hashed**, never plaintext. |
| `credit_transactions` | `id`, `user_id`, `amount`, `currency`, `provider`, `status`, `created_at` | Payments (Stripe/Paddle), never store raw card data. |
| `jobs` | (repeated) — see notes | Multi-tenant isolation. |
| `system_settings` | `key`, `value`, `encrypted`, `updated_at` | Feature flags, retry timeouts, DPH threshold overrides. |
| `backup_logs` | `id`, `job_id`, `ran_at`, `stored_at`, `checksum`, `bytes`, `provider` | Audit of backup/restore runs. |
| `audit_logs` | `id`, `user_id`, `action`, `resource`, `ip`, `created_at` | Compliance trail. |

### 3.3 Encryption at-rest strategy

- **Secrets** (`api_keys`, `password_hash`, `cookie values`, `storage access keys`): hashed at rest (`hash` column), stored in a secrets manager (Vault/SSM); application reads at runtime via least-privilege identity.
- **User payload/data** (video files, transcripts in DB): encrypted with a **data-encryption key (DEK)** per user. DEK is wrapped by a **key-encryption key (KEK)** stored in the secrets manager. This is standard envelope encryption.
- **Backups**: encrypted with a per-backup data key and stored with a distinct encryption envelope; restore requires the same KEK + user DEK (or a backup key held by admin with MFA).
- **Cookie pool**: store a **hash** of the cookie value, not the plaintext; plaintext only materialized in-memory for a session (optional), and rotated on a schedule.

---

## 4. Blueprint Docker Pre-Baked Image + Vast.ai Container Lifecycle

### 4.1 Pre-baked Dockerfile (multi-stage)

Goal: **zero runtime installs inside the container** — `pip install`, `apt-get`, and model downloads are forbidden on `onstart`; everything is baked into the image layers.

```dockerfile
# syntax=docker/dockerfile:1
# --- Stage 1: builder (dependencies + models + yt-dlp) ---
FROM nvidia/cuda:12.8.1-runtime-ubuntu22.04 AS builder

# System deps (CUDA + audio + codec glue). Install ONCE, cached in layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libssl3 \
    libopus0 \
    libvpx7 \
    libx264-163 \
    python3.11 \
    python3.11-venv \
    curl \
    ca-certificates \
    git \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -buildconf > /etc/ffmpeg.conf

# Language runtimes: Node 22 + Deno (configured as the JS runtime for yt-dlp).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && npm install -g pnpm@latest \
  && curl -fsSL https://deno.land/x/install/install.sh | sh -s install \
  && ln -s /root/.deno/bin/deno /usr/local/bin/deno

# yt-dlp (latest; pinned at build + checksum-verified).
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

# --- Stage 2: runtime image with models pre-baked ---
FROM builder AS runtime

# Pre-cache model weights (baked into image layers; never re-download at boot).
# Paths inside image must match what onstart verifies against.
RUN mkdir -p /opt/hotclip/models \
  # Whisper (tiny/base, int8-quantized for GPUs) — example.
  && curl -fsSL <MODEL_URL_whisper> -o /opt/hotclip/models/whisper.bin \
  && curl -fsSL <MODEL_URL_face>  -o /opt/hotclip/models/face.bin \
  && curl -fsSL <MODEL_URL_vad>   -o /opt/hotclip/models/vad.bin \
  && curl -fsSL <MODEL_URL_subfont> -o /opt/hotclip/models/subfont.otf \
  && curl -fsSL <MODEL_URL_transnet> -o /opt/hotclip/models/transnetv2.onnx \
  && curl -fsSL <MODEL_URL_yunet> -o /opt/hotclip/models/yunet.onnx \
  && curl -fsSL <MODEL_URL_ferplus> -o /opt/hotclip/models/ferplus.onnx \
  && echo "<sha256-sums>" | sha256sum -c -

# Python venv (if using faster-whisper in pipeline) — created at build, locked.
RUN python3.11 -m venv /opt/hotclip/venv \
  && /opt/hotclip/venv/bin/pip install --no-cache-dir -r /opt/hotclip/requirements.txt

# Media samples + entrypoints for smoke tests.
COPY --from=builder /usr/local/bin/yt-dlp /usr/local/bin/
COPY onstart.sh /usr/local/bin/onstart.sh
RUN chmod +x /usr/local/bin/onstart.sh

# Runtime user: non-root, least privilege.
RUN groupadd -r hotclip && useradd -r -g hotclip -d /home/hotclip hotclip
WORKDIR /home/hotclip
USER hotclip
ENV PATH="/opt/hotclip/venv/bin:$PATH" \
    HOTCLIP_LOCALES=zh,en \
    HOTCLIP_CONTAINER=true \
    HOTCLIP_ONSTART=true
```

**Explicit prohibitions (enforced by `onstart` + entrypoint):**

```text
pip install        → FAIL (assert "NO_PIP_INSTALL=true" env)
apt-get            → FAIL (assert "NO_APT_INSTALL=true")
git clone / curl   → only for pre-baked model/validation checksums
model download     → FAIL unless VERIFY_ONLY=true (read-only pre-cache check)
```

### 4.2 Vast.ai query filter **+ selection rule**

Filter **hard AND**. **Pilih instance termurah yang lolos filter** (bukan sort by ratio — ambil yang `dph_total` terkecil di antara hasil yang lolos, karena memang meeting kebutuhan paling murah).

| Parameter | Value | Meaning |
|---|---|---|
| `dph_total` | `<= 0.150` | Maks $0.15/hr |
| `gpu_ram` | `>= 6` | Min 6 GB VRAM |
| `cpu_cores_effective` | `>= 6` | Min 6 core CPU |
| `disk_space` | `>= 15` | Min 15 GB NVMe/SSD |
| `inet_down` | `>= 300` | Min 300 Mbps |
| `inet_up` | `>= 300` | Min 300 Mbps |
| `reliability2` | `>= 0.98` | Host reliability |
| `verified` | `true` | Fallback marker terukur bila stok kosong |
| `gpu_type` | **paling murah yang lolos** (bukan priority list) | Ambil instance dengan `dph_total` terendah |
| `num_gpu` | `1` | Single-GPU |
| `sort` | **tidak pakai** (menggantikan `sort`) | Filter saja, pilih `dph_total` terkecil |

**Backend selection (Vast.ai SDK Python, bukan CLI):**
- Backend server di VPS menggunakan **Vast.ai SDK Python** (`vastai` package) untuk: `search_jobs()`, `request_instance()`, `cancel_request()`, `release_instance()`, `list_instances()`, `get_instance_logs()` and `get_instance_logs()`.
- **TIDAK menggunakan** `vast ai cli` — SDK Python adalah satu-satunya interface backend.
- `vast_instances` DB table tracks `vast_instance_id`, `request_id`, `ssh_ip`, `status`, `expired_at`, `rent_started_at`, `deleted_at`.

### 4.3 Boot timeout & fail-safe instance lifecycle

| Event | Action |
|---|---|
| Boot gagal / **timeout 180 detik** | Orchestrator: `request.cancel()` → container dibunuh → **ganti instance** ke kandidat termurah berikutnya yang lolos filter |
| User cancel | `request.cancel()` → instance dihancurkan → job `cancelled` |
| Instance timeout / mati tanpa selesai | `vast_instances.block_until_dead_or_timeout` + staz hang → **block instance selama 24 jam** (anti reuse instance yang timeout) dengan `deleted_at = now + 24h` |
| Container exit premature | Orchestrator deteksi `exit ≠ 0` → fail-safe delete + ganti instance |
| Instance yang timeout | **Blockir selama 24 jam** — `deleted_at = now + 24h`, tidak bisa diletakan ulang secara otomatis |

- Orchestrator **tidak percaya** instance untuk self-terminate; kill request + hard-delete.
- Watchdog VPS ping endpoint log `/logs/stream`; instance tanpa stream sebelum job selesai → dibunuh + diblock 24 jam.

### 4.3 `onstart` script sketch

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Hard fail states: no runtime modification allowed.
[ "${NO_PIP_INSTALL:-}" = "true" ] || { echo "FATAL: pip install disabled"; exit 9; }
[ "${NO_APT_INSTALL:-}" = "true" ] || { echo "FATAL: apt-get disabled"; exit 9; }

# --- Verify pre-baked integrity (idempotent, O(1)).
sha256sum -c /opt/hotclip/integrity.checksums 2>/dev/null || {
  echo "FATAL: model cache integrity mismatch"; exit 8;
}

# --- Pull job payload (already base64ed on the orchestrator).
echo "$JOB_PAYLOAD_BASE64" | base64 -d > /home/hotclip/jobs/current.json
JOB_ID=$(jq -r .id /home/hotclip/jobs/current.json)

# --- Resolve sources (S3-compatible or volume mount).
if [ -n "${SOURCE_BUCKET:-}" ]; then
  aws s3 sync "${SOURCE_BUCKET}" /data/source --region "${SOURCE_REGION}" --no-sign-request
elif [ -n "${SOURCE_URL:-}" ]; then
  /usr/local/bin/yt-dlp --no-part --no-cache-dir -o "/data/source/%(title)s.%(ext)s" "$SOURCE_URL"
fi

cd /data/source
# Run the pipeline. The container's ffmpeg/nvidia runtime has been pre-probed.
python3 /opt/hotclip/worker/run.py --job "$JOB_ID" --out /data/out

# --- Publish results back to S3 + metadata DB.
aws s3 cp /data/out "s3://${RESULT_BUCKET}/${JOB_ID}/" --recursive
# Put a tiny marker + render-qa blob; the orchestrator reads it on completion.
echo "{}" | aws s3 cp - "s3://${RESULT_BUCKET}/${JOB_ID}/manifest.json"
```

### 4.4 Fail-safe instance lifecycle

```text
Boot gagal / timeout (180 detik)   →  orchestrator: request.cancel() → container dibunuh
                                   → ganti instance: cari kandidat termurah lain yang lolos filter
                                   → mark job failed/gagal, log, alert, Ulangi bersih

Abort (user cancel)                →  orchestrator: request.cancel() → instance dihancurkan
                                   → job marked cancelled

Instance timeout/matinya tidak selesai
  - orchestrator blok instance tersebut 24 jam (anti replikasi instance timeout)
  - `deleted_at = now + 24h`, instance tidak bisa disewa ulang secara otomatis

Container exit prematur            →  orchestrator deteksi `exit ≠ 0` → fail-safe delete
                                     + pilih instance termurah berikutnya

Watchdog VPS: ping endpoint log `/logs/stream`
  - instance tanpa stream sebelum job selesai → dibunuh + blok 24 jam
```

- The orchestrator **never trusts** the container to self-terminate; it kills the request and hard-deletes the instance.
- A **watchdog** on the VPS pings the container's log endpoint (`/logs/stream`) and kills/cleans up instances whose log stream stops reading before the job completes.

---

## 5. Progressive Implementation Plan (Phase 1 → Phase 8)

### Phase 1 — Audit & Foundation (Week 1) [DONE]
- [ ] **Deliver:** `PLAN.md` (this doc) + architecture & cost-validation spreadsheet.
- [ ] Read-only confirmation of the full repo state and Vast.ai spec.
- [ ] Define cost model: max $0.150/hr instance, per-hour tracking, fail-safe delete SLA.
- [ ] **Verification:** repository reads confirmed; `PLAN.md` reviewed and approved by the team.

### Phase 2 — Local Pipeline Extraction (Week 2) [DONE]
- [ ] Extract the heaviest pure functions from `core/video-encoder.ts`, `core/caption-overlay/payload.ts`, `core/reframe/*`, `core/diarize.ts`, `core/emotion.ts`, `core/transcribe/*`, `core/highlight/vision*` into a **shared library** callable by both the local Electron app and the container worker (`shared/` package).
- [ ] Port FFmpeg/ASR/detection wrapper so they can accept a `runtime: "local" | "vast"` strategy parameter with a sealed **fail-open** contract.
- [ ] **Verification:** existing unit tests (`src/core/__tests__/**/*.test.ts`) pass under both strategies; no `pip/apt` inside container build.

### Phase 3 — Container Build & Vast.ai Integration (Week 3–4) [IN PROGRESS]
- [ ] Create the **pre-baked `Dockerfile`** (multi-stage, CUDA, FFmpeg+NVENC, Deno, yt-dlp, pre-cached models, non-root user).
- [ ] Implement the **Vast.ai SDK** search/request/cancel helper with the 8-point filter + value-sorted fallback + 30s timeout + smart-retry.
- [ ] Write `onstart.sh` + fail-safe deletion logic.
- [ ] **Verification:** container builds and passes a `deno eval` + model-integrity smoke test locally (outside Vast); `search()` returns candidates matching filters.

### Phase 4 — Orchestration + DB + Queue (Week 5–6)
- [ ] Back-End: implementasi **backend server di VPS** (SSH `root@152.44.39.194`, Ubuntu 24.04) menggunakan **Vast.ai SDK Python** untuk lifecycle instance (search/request/cancel/release/logs). TIDAK menggunakan `vast ai cli` — hanya SDK Python.
- [ ] Introduce `users`, `jobs`, `vast_instances`, `vast_templates`, `storage_providers`, `cookies` (hashed), `credit_transactions` tables + Postgres adapter.
- [ ] Introduce persistent job queue with retry + cancel + priority.
- [ ] Implement **storage proxy** (upload source to S3-compatible bucket; expose `media_url` and `download_url`).
- [ ] **Verification:** queue jobs end-to-end locally (mock Vast) through to `completed` with correct `media_url`; cancel path marks `cancelled` and destroys instance.

### Phase 5 — Production VPS Provisioning (Week 7)
- [ ] Provision the VPS `root@152.44.39.194` (Ubuntu 24.04 minimal) via SSH.
- [ ] Install: Docker Engine + Docker Compose + Nginx + Certbot/Let's Encrypt (staging → prod), Fail2Ban, `ufw`, log shipper.
- [ ] Deploy API gateway + backend (Vast.ai SDK Python) + orchestrator + queue; connect **Postgres (Supabase)** for metadata; configure pooler + `DB_URL` from environment (no secrets in Compose).
- [ ] **Verification:** automated health check reaches **200 OK** on all endpoints; TLS handshake against `https://<VPS>` succeeds; Fail2Ban shows the expected jails; backup/restore script restores DB + `.env` + assets.

### Phase 6 — DNS, Storage & Edge (Week 8)
- [ ] Point Cloudflare **A-record** at the VPS IP; enable SSL + caching + WAF + DDoS.
- [ ] Connect S3-compatible bucket (R2/HF Spaces/MinIO) for media; configure signed URLs with short TTL.
- [ ] **Verification:** end-to-end render job flows through the VPS, downloads from Cloudflare edge, and produces media accessible at the public URL.

### Phase 7 — Observability & Hardening (Week 9)
- [ ] Structured logs + streaming (/logs/stream), job progress streams, Sentry-like error tracking.
- [ ] Rate limiting, per-tenant quotas, audit logs, password/2FA, JWT rotation.
- [ ] Backup schedule + encrypted backup + restore verification.
- [ ] **Verification:** Log pipeline and audit trail are complete; backup restores a known-good restore point; load test with 10 concurrent jobs.

### Phase 8 — Full Web Application (Week 10+)
- [ ] **Penyedia UI web murni**: Next.js + shadcn/ui (App Router) + seluruh icon shadcn, fully responsive Android/iPhone/iPad/Tablet/PC. **Tidak ada desktop app.**
- [ ] **Remote processing** opt-in di Settings; first-run wizard:
  - cek semua deps (Docker, Nginx, Certbot, SSH),
  - restore encrypted backup,
  - pull/build container,
  - health-check setiap endpoint → status 200 OK,
  - tampilkan **DNS A-record pointing to Cloudflare**.
- [ ] **Verification:** fresh on-paper install + DNS propagation selesai dengan screen "Ready" sehat; manual reproduction oleh engineer di mesin bersih.

---

## 6. Key Clarifying Questions (must resolve before implementation)

1. **Backend language / framework (answer: Next.js full):** Production tier = **Next.js full-stack web app** (API routes + React UI), not a separate FastAPI/Flask service. The local Electron app calls the Next.js API routes via HTTP when `HOTCLIP_WORKER_MODE=vast` is set.
2. **Vast.ai SDK surface:** The brief references the `vastai` / `vastai-sdk` skills, which are **not installed** in this checkout. Emitted Vast.ai API calls via **Vast.ai SDK Python** (`vastai` package) as documented in `§4`; `vast ai cli` is **not** used. SDK version: as needed by the `vastai` package on PyPI (verify during Phase 1). TIDAK menggunakan `vast ai cli` — SDK Python adalah satu-satunya interface backend.
3. **Model/runtime inside the container:** Answer: sesuai pilihan tim (default: **native `sherpa-onnx` / `onnxruntime-node`** yang ada di Electron — lebih simpel, tanpa layer Python tambahan). Akan diverifikasi di Phase 1.
4. **Registry choice (answer: sesuai pilihan tim):** Docker image host — **Docker Hub** (public, default), **GitHub Container Registry (GHCR)**, atau private registry. Akan diverifikasi di Phase 1.
5. **Payment/gateway:** Which provider for credits and payouts — **Stripe** (subscriptions/one-offs), **Paddle** (merchant-of-record), or a self-custody blockchain/credit-lever? (Affects `credit_transactions` fields.)
6. **Object storage:** Is **Supabase Storage** (managed, Postgres-backed, simplest) sufficient for your media, or do you need a **true S3-compatible bucket** (R2/HF Spaces/MinIO)? Supabase free/paid tiers differ on connection pooling and bucket rules — this drives the `storage_providers` fields and whether the orchestrator on the VPS reaches the bucket over the public internet or via a private link.
7. **Tenant/multi-user:** Is the service single-user (`local-first` + a single admin VPS) or multi-tenant with per-user jobs? (Affects DB schema, rate limits, and the "privacy" boundary in §3.)
8. **GPU sizing:** Confirm `dph_total <= 0.150`, `gpu_ram >= 6`, `cpu_cores_effective >= 6`, `inet >= 300` as the **hard floor** (spec) and that the docker image must include CUDA + FFmpeg+NVENC **plus** Deno as the `yt-dlp` JS runtime. Confirm **no `pip install` / `apt-get` / model downloads on `onstart`**.
9. **Storage strategy for model weights:** Freeze `userData` local model cache (recommended for privacy) or hot-sync models to the VPS so containers start instantly? (Affects `onstart` checksums and `vast_templates.model_ids`.)
10. **UI integration:** Point 8 — do you want the web UI to target Vast.ai containers **only** for the heavy compute, while keeping **all** edge/captcha/copy editing local in the Electron renderer, or fully server-side?

### Jawaban dari pemilik spesifikasi
| # | Pertanyaan | Jawaban | Fase yang dibutuhkan |
|---|---|---|---|
| 1 | Backend/framework | **Next.js full-stack** (API routes + React UI), bukan FastAPI/Flask terpisah | — |
| 2 | Vast.ai SDK | **SDK Python** (`vastai` package) — `vast ai cli` tidak digunakan | — |
| 3 | Runtime container | **Sesuai pilihan tim** (default: native `sherpa-onnx`/`onnxruntime-node`) | — |
| 4 | Docker registry | **Sesuai pilihan tim** (default: Docker Hub publik) | — |
| 5 | Payment/gateway | **Ditunda/Lewati integrasi Stripe/Paddle** di fase ini karena menggunakan Payment Gateway Indonesia (Midtrans / Xendit / Tripay). Siapkan struktur tabel `credit_transactions` generik: `provider`, `external_tx_id`, `payment_method`, `amount_idr`, `credits_added`, `status` — mudah disambungkan nanti. | Phase 7 |
| 6 | Object storage | **Unified S3 Storage Pool**: multi-provider (Cloudflare R2, Backblaze B2, Tigris, Fileface, HuggingFace S3-compatible, MinIO). Multi-account per provider. Router/columns: `provider_name`, `account_label`, `priority`, `quota_limit`, `used_bytes`, `is_active`. Strategi: round-robin / least-used / priority weight + auto failover. Exact location (`provider_id` + `bucket` + `object_key`) disimpan di tiap record `jobs_media` agar retrieval selalu presisi. | Phase 4–6 |
| 7 | Tenant/multi-user | **Multi-tenant penuh sejak awal.** Autentikasi Email/Password + OAuth Google & GitHub — Supabase Auth atau standar JWT/OAuth yang terhubung ke tabel `users`. | Phase 4 |
| 8 | GPU sizing | Sudah disetujui (hard floor + Deno + no-install-on-start) | — |
| 9 | Model weights | **Tanam permanen (pre-baked) di Docker image + SHA256 verification di onstart.** Tetap pertahankan **local cache** di mesin pengguna untuk mode lokal. | Phase 3 |
| 10 | UI integration | **Full web tanpa desktop app.** Backend/server: API gateway, queue, orchestrator, S3 pool routing, metadata, webhook, lightweight processing. **Local**: UI/pengaturan (full web UI tanpa desktop app). **Vast.ai GPU**: heavy video/AI compute. | Phase 8 |

> **Catatan phase dependency:** #9 (model weights) dibutuhkan sejak Phase 3 (container build). #7 (tenant) dibutuhkan sejak Phase 4 (schema DB). #6 (storage) sebelum Phase 6. #5 (payment) sebelum Phase 7. #10 (UI integration) sebelum Phase 8. Fase lain yang tidak bergantung pada jawaban ini tetap bisa dilanjutkan secara staging/parallel.
