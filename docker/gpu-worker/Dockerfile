# syntax=docker/dockerfile:1
#
# HotClip GPU Worker — lean runtime image (no pre-baked model weights).
#
# Image contents:
#   - Node 22 runtime + pnpm + tsx (no dev deps, scripts ignored).
#   - The worker's TypeScript source: src/worker, src/shared, src/core.
#   - AWS CLI v2 (presigned PUT result uploads) + ffmpeg (NVENC) + yt-dlp.
#
# Model weights are NOT baked into the image. They are downloaded at container
# start into a writable cache volume mounted at /app/models (see onstart.sh).
# This keeps the image small and fast to build/pull, while the cached weights
# persist across restarts.
#
# Build:
#   docker build -t hotclip-gpu-worker:latest -f docker/gpu-worker/Dockerfile .
#
# Run (Vast.ai IoC mode):
#   docker run --gpus all \
#     -e HTTP_PORT=8080 \
#     -e MODEL_DIR=/app/models \
#     -e RESULT_WEBHOOK=https://main/api/v1/worker/webhook \
#     -e VAST_WEBHOOK_SECRET=<secret> \
#     -e JOB_ID=<job> -e HOTCLIP_JOB='<json>' \
#     -v hotclip-models:/app/models \
#     hotclip-gpu-worker
#
# The entrypoint (onstart.sh) verifies model integrity and downloads the pinned
# model set into /app/models on first boot if the cache volume is empty or
# corrupt.

FROM node:22-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    MODEL_DIR=/app/models \
    HTTP_PORT=8080

# ---- runtime system deps: ffmpeg (NVENC), TLS, AWS CLI v2, yt-dlp ----
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libssl3 libopus0 libvpx7 \
        curl ca-certificates unzip git \
        python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -buildconf > /etc/ffmpeg.conf \
    && test -x "$(command -v ffmpeg)" \
    && echo "ffmpeg (NVENC-capable) initialized" \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && ln -sf /usr/local/aws-cli/v2/current/bin/aws /usr/local/bin/aws \
    && rm -rf /tmp/awscliv2.zip /tmp/aws /tmp/awscliv2 \
    && aws --version \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/download/yt-dlp-2026.04.01/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && npm install -g pnpm@latest tsx \
    && npm cache clean --force

# ---- locked virtualenv (production PATH). No runtime pip/apt allowed. ----
RUN python3 -m venv /opt/hotclip/venv \
    && /opt/hotclip/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/hotclip/venv/bin/pip install --no-cache-dir -q -r /dev/null \
    && rm -rf /root/.cache/pip

# ---- worker sources + production deps ----
WORKDIR /home/hotclip

COPY package.json pnpm-lock.yaml* ./

# Install production-only, ignore scripts (no build-time tooling needed at
# runtime). Fall back to npm when pnpm is unavailable.
RUN set -eux; \
    if command -v pnpm >/dev/null 2>&1; then \
      pnpm install --prod --ignore-scripts --frozen-lockfile; \
    else \
      npm install --omit=dev --ignore-scripts --no-audit --no-fund; \
    fi

# Worker + shared + core sources (imported by src/worker/gpu-server.ts via
# relative paths: ../shared/pipeline, ../../core/review-memory).
COPY src/worker /home/hotclip/src/worker
COPY src/shared /home/hotclip/src/shared
COPY src/core /home/hotclip/src/core

# Startup script + pinned model manifest (small text, not model weights).
COPY docker/gpu-worker/onstart.sh /usr/local/bin/onstart.sh
COPY docker/gpu-worker/models.manifest /home/hotclip/models.manifest
RUN chmod +x /usr/local/bin/onstart.sh \
    && groupadd -r hotclip \
    && useradd -r -g hotclip -d /home/hotclip -s /sbin/nologin hotclip \
    && chown -R hotclip:hotclip /home/hotclip/src /usr/local/bin/onstart.sh \
    && mkdir -p /data/work/cache /data/work/render /data/source /data/out \
    && chown -R hotclip:hotclip /data

WORKDIR /home/hotclip
USER hotclip

VOLUME /app/models
ENTRYPOINT ["/usr/local/bin/onstart.sh"]
