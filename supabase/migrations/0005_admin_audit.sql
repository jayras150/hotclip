-- ============================================================================
-- 0005_admin_audit.sql — Admin audit trail (`admin_audit_logs`)
--
-- Satu tabel append-only untuk semua aksi sensitif dari dashboard admin:
-- ban/unban user, reset quota, destroy/cancel instance Vast.ai, toggle
-- provider storage, dan sesi admin yang berhasil lolos 4 layer
-- Defense-in-Depth (lihat `src/server/admin-auth.ts`).
--
-- Catatan keamanan (Supabase Security Checklist):
--   - RLS aktif; hanya role `authenticated` yang boleh membaca/menulis,
--     dan hanya baris miliknya sendiri (`admin_id = auth.uid()`).
--   - SECURITY INVOKER (tidak ada `security definer`) -> tidak bypass RLS.
--   - `ip inet` agar validasi format alamat dilakukan oleh Postgres.
--   - Index `idx_admin_audit_created` untuk viewer audit (order by created_at).
--
-- Idempotent: aman dijalankan ulang.
-- ============================================================================

create table if not exists public.admin_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references public.users(id) on delete set null,
  admin_email  text,
  action       text not null default '',
  entity       text not null default '',
  entity_id    text,
  details      jsonb not null default '{}'::jsonb,
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

comment on table public.admin_audit_logs is
  'Append-only audit trail for admin dashboard actions (4-layer gated).';

comment on column public.admin_audit_logs.admin_id is
  'Clerk user id of the acting admin, mapped to public.users(id) when known.';

-- Viewer audit: newest first, plus an index for per-admin lookups.
create index if not exists idx_admin_audit_created
  on public.admin_audit_logs (created_at desc);

create index if not exists idx_admin_audit_admin
  on public.admin_audit_logs (admin_id, created_at desc);

create index if not exists idx_admin_audit_entity
  on public.admin_audit_logs (entity, entity_id);

alter table public.admin_audit_logs enable row level security;

-- ----------------------------------------------------------------------------
-- Policies — `TO authenticated` + ownership predicate (BOLA/IDOR guard).
-- Read/write diizinkan hanya untuk baris yang admin_id-nya milik pemanggil.
-- ----------------------------------------------------------------------------

drop policy if exists "admin_audit_logs: admin select" on public.admin_audit_logs;
create policy "admin_audit_logs: admin select" on public.admin_audit_logs
  for select
  to authenticated
  using ((select auth.uid()) = admin_id);

drop policy if exists "admin_audit_logs: admin insert" on public.admin_audit_logs;
create policy "admin_audit_logs: admin insert" on public.admin_audit_logs
  for insert
  to authenticated
  with check ((select auth.uid()) = admin_id);

-- Append-only: tidak ada policy UPDATE/DELETE, sehingga baris tidak bisa
-- diubah atau dihapus lewat Data API dengan role `authenticated`.
