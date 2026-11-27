#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/c/Users/WINDOWS 11 PRO/Documents/hotclip"
ARCHIVE_DIR="/tmp/hotclip-deploy"

mkdir -p "$ARCHIVE_DIR"
rm -rf "$ARCHIVE_DIR"/*

cd "$REPO_DIR"

# Create deploy archive
echo "=== Creating git archive of HEAD (main) ==="
git archive main | tar -x -C "$ARCHIVE_DIR"

echo "=== Archive contents ==="
ls -la "$ARCHIVE_DIR"

echo "=== Web src app dirs ==="
ls -la "$ARCHIVE_DIR/web/src/app/(auth)"

echo "=== Tracked file count ==="
git ls-tree -r --name-only main | wc -l

echo "=== Archive preparation DONE ==="
