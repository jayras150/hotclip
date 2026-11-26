#!/usr/bin/env python3
"""apply-migration.py — fallback runner migrasi Supabase.

Koneksi Postgres langsung (5432/6543) sering diblokir dari VPS maupun laptop.
Skrip ini mencoba berurutan:
  1. Management API  POST https://api.supabase.com/v1/projects/{ref}/database/query
     (butuh SUPABASE_ACCESS_TOKEN — personal access token, bukan service role).
  2. Direct psycopg2 bila tersedia dan port terbuka.

Usage:
  SUPABASE_ACCESS_TOKEN=... python scripts/apply-migration.py <file.sql> [...]
  POSTGRES_URL=postgresql://... python scripts/apply-migration.py <file.sql>
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
PROJECT_REF = os.environ.get(
    "SUPABASE_PROJECT_REF",
    SUPABASE_URL.split("//")[-1].split(".")[0] if SUPABASE_URL else "",
)
ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
POSTGRES_URL = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL", "")


def via_management_api(sql: str) -> bool:
    if not (ACCESS_TOKEN and PROJECT_REF):
        return False
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {ACCESS_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = resp.read().decode("utf-8", "replace")
            print(f"  management-api HTTP {resp.status}: {payload[:300]}")
            return resp.status < 400
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        print(f"  management-api HTTP {exc.code}: {detail[:600]}")
        return False
    except Exception as exc:  # noqa: BLE001
        print(f"  management-api error: {exc}")
        return False


def via_psycopg(sql: str) -> bool:
    if not POSTGRES_URL:
        return False
    try:
        import psycopg  # type: ignore
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            print("  psycopg not installed")
            return False
    try:
        conn = psycopg.connect(POSTGRES_URL, connect_timeout=20)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.close()
        print("  psycopg OK")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  psycopg error: {exc}")
        return False


def main() -> int:
    files = sys.argv[1:]
    if not files:
        print(__doc__)
        return 2
    failures = 0
    for path in files:
        with open(path, "r", encoding="utf-8") as fh:
            sql = fh.read()
        print(f"=== {path} ({len(sql)} bytes) ===")
        # Management API accepts multi-statement scripts; psycopg too.
        ok = via_management_api(sql) or via_psycopg(sql)
        if not ok:
            failures += 1
            print("  FAILED — no working channel")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
