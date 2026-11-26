#!/usr/bin/env node
/**
 * apply-migration.mjs — jalankan satu file SQL melalui endpoint pg-meta
 * Supabase (`POST /pg-meta/query`). Dipakai oleh vps-apply-migrations.sh
 * agar migrasi bisa diterapkan tanpa psql / db password.
 *
 * Usage: node apply-migration.mjs <supabase-url> <service-role-key> <file.sql>
 */
const [url, key, file] = process.argv.slice(2);
if (!url || !key || !file) {
  console.error("usage: node apply-migration.mjs <supabase-url> <key> <file.sql>");
  process.exit(2);
}

const fs = await import("node:fs");
const sql = fs.readFileSync(file, "utf8");

const endpoint = url.replace(/\/+$/, "") + "/pg-meta/query";
const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text.slice(0, 2000));
process.exit(res.ok ? 0 : 1);
