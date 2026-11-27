#!/usr/bin/env bash
set -euo pipefail

VPS="root@209.94.60.207"
REMOTE_DIR="/opt/hotclip"
REMOTE_AUTH='/web/src/app/(auth)'

echo "=== Syncing deploy archive to VPS ==="
tar -czf - -C /tmp/hotclip-deploy . | ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS" "cat > /tmp/hotclip-deploy.tar.gz && cd $REMOTE_DIR && tar -xzf /tmp/hotclip-deploy.tar.gz && echo '=== SYNC DONE ==='"

echo "=== Cleanup remote archive ==="
ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS" "rm -f /tmp/hotclip-deploy.tar.gz"

echo "=== Verifying sync: web src app dirs ==="
ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS" "cd $REMOTE_DIR && echo '---SIGNIN---' && ls -la $REMOTE_AUTH/sign-in && echo '---SIGNUP---' && ls -la $REMOTE_AUTH/sign-up"

echo "=== Rebuilding web + api ==="
ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS" "cd $REMOTE_DIR && docker compose -f docker-compose.vps.yml up -d --build web api"

echo "=== Checking container status ==="
ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS" "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
