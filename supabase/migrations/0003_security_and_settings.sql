-- ============================================================================
-- 0003_security_and_settings.sql — Credentials, API keys, vault, settings,
--                                and per-user envelope encryption keys.
--
-- Tables:
--   public.device_fingerprints — perangkat tepercaya per user (pub key + hash)
--   public.api_keys            — token API (hash saja; plaintext tidak disimpan)
--   public.vault               — secret per user, terenkripsi at-rest
--   public.system_settings     — setting global (key/value JSONB), tulis admin
--   public.user_data_keys      — DEK per user di-wrap oleh KEK (envelope)
--
-- Catatan keamanan:
--   - Semua tabel user-scoped pakai RLS `TO authenticated` + auth.uid() = user_id.
--   - Tidak ada fungsi DEFINER (privilege escalation) di schema public.
--   - Idempotent: create ... if not exists + drop policy if exists sebelum create.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. public.users — kolom kredensial & pointer DEK
--    password_hash : hash password aplikasi (bukan kolom auth bawaan Supabase).
--    enc_key_id    : pointer ke public.user_data_keys(id), DEK aktif user ini.
-- ----------------------------------------------------------------------------
alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists enc_key_id uuid;

comment on column public.users.password_hash is
  'Hash password lokal (argon2/bcrypt) bila tidak memakai Supabase Auth.';
comment on column public.users.enc_key_id is
  'Pointer ke public.user_data_keys.id — DEK aktif untuk envelope encryption.';

-- ----------------------------------------------------------------------------
-- 2. public.device_fingerprints — perangkat tepercaya per user
-- ----------------------------------------------------------------------------
create table if not exists public.device_fingerprints (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  pub_key          text,
  fingerprint_hash text not null,
  label            text,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint uq_device_fingerprints_user_hash unique (user_id, fingerprint_hash)
);

create index if not exists idx_device_fingerprints_user
  on public.device_fingerprints (user_id);

alter table public.device_fingerprints enable row level security;

drop policy if exists "device_fingerprints: owner select" on public.device_fingerprints;
create policy "device_fingerprints: owner select" on public.device_fingerprints
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "device_fingerprints: owner insert" on public.device_fingerprints;
create policy "device_fingerprints: owner insert" on public.device_fingerprints
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "device_fingerprints: owner update" on public.device_fingerprints;
create policy "device_fingerprints: owner update" on public.device_fingerprints
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "device_fingerprints: owner delete" on public.device_fingerprints;
create policy "device_fingerprints: owner delete" on public.device_fingerprints
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 3. public.api_keys — token API per user (hash-only, bisa dicabut)
-- ----------------------------------------------------------------------------
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,
  scopes       text[] not null default '{read}',
  active       boolean not null default true,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create index if not exists idx_api_keys_user
  on public.api_keys (user_id);

create index if not exists idx_api_keys_user_active
  on public.api_keys (user_id, active);

alter table public.api_keys enable row level security;

drop policy if exists "api_keys: owner select" on public.api_keys;
create policy "api_keys: owner select" on public.api_keys
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "api_keys: owner insert" on public.api_keys;
create policy "api_keys: owner insert" on public.api_keys
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "api_keys: owner update" on public.api_keys;
create policy "api_keys: owner update" on public.api_keys
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "api_keys: owner delete" on public.api_keys;
create policy "api_keys: owner delete" on public.api_keys
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 4. public.vault — secret per user, terenkripsi at-rest (value_encrypted)
-- ----------------------------------------------------------------------------
create table if not exists public.vault (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  key                 text not null,
  value_encrypted     text not null,
  encrypted_at_rest   boolean not null default true,
  key_version         integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_vault_user_key unique (user_id, key)
);

create index if not exists idx_vault_user
  on public.vault (user_id);

alter table public.vault enable row level security;

drop policy if exists "vault: owner select" on public.vault;
create policy "vault: owner select" on public.vault
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "vault: owner insert" on public.vault;
create policy "vault: owner insert" on public.vault
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "vault: owner update" on public.vault;
create policy "vault: owner update" on public.vault
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "vault: owner delete" on public.vault;
create policy "vault: owner delete" on public.vault
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 5. public.system_settings — setting global (admin-only write)
-- ----------------------------------------------------------------------------
create table if not exists public.system_settings (
  key        text primary key,
  value      jsonb not null default '{}',
  encrypted  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

-- Mendukung pencarian/penyaringan nilai JSONB tanpa index penuh.
create index if not exists idx_system_settings_value_gin
  on public.system_settings using gin (value jsonb_path_ops);

alter table public.system_settings enable row level security;

drop policy if exists "system_settings: authenticated read" on public.system_settings;
create policy "system_settings: authenticated read" on public.system_settings
  for select
  to authenticated
  using (true);

drop policy if exists "system_settings: admin insert" on public.system_settings;
create policy "system_settings: admin insert" on public.system_settings
  for insert
  to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_admin = true
  ));

drop policy if exists "system_settings: admin update" on public.system_settings;
create policy "system_settings: admin update" on public.system_settings
  for update
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_admin = true
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_admin = true
  ));

drop policy if exists "system_settings: admin delete" on public.system_settings;
create policy "system_settings: admin delete" on public.system_settings
  for delete
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_admin = true
  ));

-- ----------------------------------------------------------------------------
-- 6. public.user_data_keys — envelope encryption key registry
--
-- Alur envelope:
--   1) Saat onboarding, backend membuat DEK acak (AES-256-GCM) per user.
--   2) DEK di-wrap (dienkripsi) oleh KEK milik server/KMS -> disimpan sebagai
--      `wrapped_dek` beserta `kek_id` dan versi algoritma. KEK tidak pernah
--      masuk database.
--   3) Data sensitif user (vault, credentials) dienkripsi memakai DEK tersebut;
--      DB hanya menyimpan `wrapped_dek` + payload terenkripsi (ciphertext),
--      sehingga dump database saja tidak cukup untuk mendekripsi data.
--   4) Rotasi: buat baris/versi baru atau isi `rotated_at`; DEK lama tetap
--      di-wrap agar data lama bisa dibaca hingga re-enkripsi selesai.
-- ----------------------------------------------------------------------------
create table if not exists public.user_data_keys (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  wrapped_dek text not null,          -- DEK di-wrap oleh KEK (bukan DEK mentah)
  kek_id     text not null,           -- identifier KEK di KMS/server
  algorithm  text not null default 'AES-256-GCM',
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint uq_user_data_keys_user unique (user_id)
);

comment on table public.user_data_keys is
  'Envelope encryption: DEK unik per user di-wrap oleh KEK (kek_id); '
  'database hanya menyimpan wrapped_dek dan payload_encrypted, tidak pernah DEK mentah.';
comment on column public.user_data_keys.wrapped_dek is
  'DEK terenkripsi oleh KEK; hanya bisa dibuka oleh layanan pemegang KEK.';

create index if not exists idx_user_data_keys_user
  on public.user_data_keys (user_id);

alter table public.user_data_keys enable row level security;

drop policy if exists "user_data_keys: owner select" on public.user_data_keys;
create policy "user_data_keys: owner select" on public.user_data_keys
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_data_keys: owner insert" on public.user_data_keys;
create policy "user_data_keys: owner insert" on public.user_data_keys
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_data_keys: owner update" on public.user_data_keys;
create policy "user_data_keys: owner update" on public.user_data_keys
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_data_keys: owner delete" on public.user_data_keys;
create policy "user_data_keys: owner delete" on public.user_data_keys
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
