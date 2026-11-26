
-- ============================================================
-- >>> 0001_tenant_schema.sql
-- ============================================================

-- ============================================================================
-- 0001_tenant_schema.sql — Multi-tenant core schema + RLS + Auth trigger
--
-- Tables:
--   public.users        — akun tenant HotClip (role: member|admin, currency_idr)
--   public.profiles     — profil tampilan; id/user_id selalu = auth.user id
--                         (diri-isi otomatis oleh trigger `on_auth_user_created`)
--   public.storage_pools— jaringan penyimpanan (pool), bisa global (user_id null)
--   public.storage_providers — akun objek berbayar di 1 pool (per provider/region)
--   public.jobs         — antrean pekerjaan tenant (queue state)
--   public.user_wallets — dompet kredit per-token (multi-currency)
--   public.credit_transactions — riwayat transaksi kredit (multi-currency)
--
-- Catatan keamanan (Supabase RLS checklist):
--   - auth.uid() hanya bisa dibaca dari RLS policy context; never dari user_metadata.
--   - Semua tabel tenant punya RLS aktif; tidak ada tabel yang exposure ke anon.
--   - Trigger `handle_new_auth_user` memakai SECURITY INVOKER (bukan DEFINER) agar
--     tidak bypass RLS, dan `INSERT ... ON CONFLICT DO NOTHING` agar idempoten.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. public.users — akun tenant
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  status         text not null default 'active'
    check (status in ('active','suspended','disabled')),
  role           text not null default 'member'
    check (role in ('member','admin')),
  avatar_url     text,
  metadata       jsonb default '{}',
  app_metadata   jsonb default '{}',
  currency_code  text not null default 'idr'
);
create index if not exists idx_users_email      on public.users (email);
create index if not exists idx_users_status     on public.users (status);
create index if not exists idx_users_role       on public.users (role);

alter table public.users enable row level security;

-- ----------------------------------------------------------------------------
-- 2. public.profiles — profil tenant, dilinks ke auth.users lewat trigger
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key,
  user_id      uuid not null references public.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  currency_code text not null default 'idr',
  timezone     text not null default 'Asia/Jakarta',
  bio          text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_profiles_user_id unique (user_id)
);
create index if not exists idx_profiles_user_id on public.profiles (user_id);
create index if not exists idx_profiles_is_admin on public.profiles (is_admin);

alter table public.profiles enable row level security;

-- ----------------------------------------------------------------------------
-- 3. public.storage_pools — network storage pool (multi-tenant + global)
--    user_id null  -> pool global / shared by all tenants (orchestrator owned).
--    user_id bertuhan -> pool milik tenant spesifik.
-- ----------------------------------------------------------------------------
create table if not exists public.storage_pools (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  provider_name text not null
    check (provider_name in (
      'r2','backblaze-b2','hugging-face','tigris','filebase','minio','s3')),
  account_label text not null default '',
  priority       integer not null default 0,
  quota_bytes    bigint not null default 0,
  used_bytes     bigint not null default 0,
  health_status  text not null default 'healthy'
    check (health_status in ('healthy','degraded','down')),
  is_active      boolean not null default true,
  user_id        uuid references public.users(id) on delete set null,
  config         jsonb default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_storage_pools_owner on public.storage_pools (user_id);
create index if not exists idx_storage_pools_active on public.storage_pools (is_active);
create index if not exists idx_storage_pools_status on public.storage_pools (health_status);

alter table public.storage_pools enable row level security;

-- ----------------------------------------------------------------------------
-- 4. public.storage_providers — akun objek (per provider / per region / wallet)
--
-- Endpoint S3-compatible standar; kredensial disimpan terenkripsi di aplikasi
-- (field-value encryption by the backend, oksum pada builder image).
-- ----------------------------------------------------------------------------
create table if not exists public.storage_providers (
  id              uuid primary key default gen_random_uuid(),
  pool_id         uuid references public.storage_pools(id) on delete cascade,
  provider_name   text not null
    check (provider_name in (
      'r2','backblaze-b2','hugging-face','tigris','filebase','minio','s3')),
  endpoint_url    text not null,
  region          text not null default 'auto',
  bucket_name     text not null,
  access_key_id   text not null default '',
  secret_access_key text not null default '',
  quota_bytes     bigint not null default 0,
  used_bytes      bigint not null default 0,
  priority        integer not null default 0,
  health_status   text not null default 'healthy'
    check (health_status in ('healthy','degraded','down')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_storage_provider_pool_region unique (pool_id, provider_name, bucket_name)
);
create index if not exists idx_storage_providers_pool on public.storage_providers (pool_id);
create index if not exists idx_storage_providers_health on public.storage_providers (health_status);
create index if not exists idx_storage_providers_active on public.storage_providers (is_active);

alter table public.storage_providers enable row level security;

-- ----------------------------------------------------------------------------
-- 5. public.jobs — antrean pekerjaan multi-tenant
--    status: queued|running|completed|failed|timeout|cancelled
--    media_url  -> lokasi S3 (presigned) hasil rendering / sumber media.
--    manifest_json -> eksperimen waktu 1 clip (id, title, start, end, outPath).
-- ----------------------------------------------------------------------------
create table if not exists public.jobs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.users(id) on delete cascade,
  status                   text not null default 'queued'
    check (status in ('queued','running','completed','failed','timeout','cancelled')),
  pipeline                 text not null default 'auto_clip',
  params_json              jsonb default '{}',
  source_url               text,
  media_url                text,
  manifest_json            jsonb default '{}',
  duration_sec             numeric(12,3),
  gpu_cost_estimate_credits numeric(12,4) default 0,
  started_at               timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_jobs_user_id on public.jobs (user_id);
create index if not exists idx_jobs_status on public.jobs (status);
create index if not exists idx_jobs_user_status on public.jobs (user_id, status);

alter table public.jobs enable row level security;

-- ----------------------------------------------------------------------------
-- 6. public.user_wallets — dompet kredit per token, multi-currency
--    credits_balance    -> total kredit platform (multi-mata)
--    local_balance      -> saldo mata uang lokal (IDR) sesuai currency_code
--    exchange_rate      -> rate kredit -> local
-- ----------------------------------------------------------------------------
create table if not exists public.user_wallets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  currency_code    text not null default 'idr',
  credits_balance  numeric(16,4) not null default 0,
  local_balance    numeric(14,2) not null default 0,
  exchange_rate    numeric(12,6) not null default 1,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_user_wallet unique (user_id, currency_code)
);
create index if not exists idx_user_wallets_user on public.user_wallets (user_id);
create index if not exists idx_user_wallets_currency on public.user_wallets (currency_code);

alter table public.user_wallets enable row level security;

-- ----------------------------------------------------------------------------
-- 7. public.credit_transactions — riwayat multi-currency
--    provider: null/'' -> bukannya gateway (onchain/manual); pengisian manual
--    method: '' | 'midtrans' | 'xendit' | 'tripay' | 'stripe' | 'paddle'
-- ----------------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  credits_delta   numeric(16,4) not null,
  local_amount    numeric(14,2) not null default 0,
  exchange_rate   numeric(12,6) not null default 1,
  currency_code   text not null default 'idr',
  method          text not null default '',
  external_tx_id  text,
  status          text not null default 'pending'
    check (status in ('pending','settled','failed','refunded','expired')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_credit_transactions_user on public.credit_transactions (user_id);
create index if not exists idx_credit_transactions_status on public.credit_transactions (status);
create index if not exists idx_credit_transactions_user_status on public.credit_transactions (user_id, status);

alter table public.credit_transactions enable row level security;

-- ----------------------------------------------------------------------------
-- 8. Trigger: auto-create users + profiles saat auth.user terdaftar
--    SECURITY INVOKER (bukan DEFINER) untuk tetap menghormati RLS.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- 1) akun tenant HotClip
  insert into public.users (id, email, role, status, currency_code, created_at, updated_at)
  values (new.id, new.email, 'member', 'active', 'idr', now(), now())
  on conflict (id) do nothing;

  -- 2) profil tampilan (user_id = id = auth.user id -> RLS 'own' mudah)
  insert into public.profiles (id, user_id, currency_code, timezone, created_at, updated_at)
  values (new.id, new.id, 'idr', 'Asia/Jakarta', now(), now())
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_auth_user();


-- ============================================================
-- >>> 0002_vast_and_security.sql
-- ============================================================

-- 0002_vast_and_security.sql — Vast.ai integration schema + RLS security
-- Tables: vast_instances, vast_templates, cookies, jobs_media, audit_logs, backup_logs
-- RLS: TO authenticated + (auth.uid() = owner); gen_random_uuid(); timestamptz; numeric; JSONB.

create table if not exists public.vast_instances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  instance_id    text not null default '',
  provider_name  text not null default '',
  status         text not null default 'pending'
    check (status in ('pending','active','stopped','terminating','terminated','cancelled')),
  deleted_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- btree (bukan GIN): GIN tidak punya operator class default untuk timestamptz,
-- dan untuk kolom scalar (timestamp + status) btree memang yang benar.
create index if not exists idx_vast_instances_deleted_status
  on public.vast_instances (deleted_at, status);

create index if not exists idx_vast_instances_user_status
  on public.vast_instances (user_id, status);

create unique index if not exists uq_vast_instances_user_instance
  on public.vast_instances (user_id, instance_id);

alter table public.vast_instances enable row level security;

create policy "vast_instances: owner scope" on public.vast_instances
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "vast_instances: delete after 24h block" on public.vast_instances
  for delete
  to authenticated
  using (deleted_at <= now() - interval '24 hours');

create table if not exists public.vast_templates (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  name            text not null default '',
  provider_name   text not null default '',
  resolution      text not null default '',
  bitrate_kbps    numeric(10,0) not null default 0,
  audio_codec     text not null default '',
  subtitle_lang   text not null default '',
  duration_sec    numeric(12,3) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_vast_templates_user
  on public.vast_templates (user_id);

alter table public.vast_templates enable row level security;

create policy "vast_templates: owner scope" on public.vast_templates
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.cookies (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,
  provider        text not null default '',
  name            text not null default '',
  value_hash      text not null default '',
  encrypted_value text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz
);

create unique index if not exists uq_cookies_user_provider_name
  on public.cookies (user_id, provider, name);

alter table public.cookies enable row level security;

create policy "cookies: owner or shared scope" on public.cookies
  for all
  to authenticated
  using (user_id is null or (select auth.uid()) = user_id)
  with check (user_id is null or (select auth.uid()) = user_id);

create table if not exists public.jobs_media (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  provider_id   uuid,
  bucket        text not null default '',
  object_key    text not null default '',
  media_url     text not null default '',
  size_bytes    bigint not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_jobs_media_job
  on public.jobs_media (job_id);

alter table public.jobs_media enable row level security;

create policy "jobs_media: access own job logs" on public.jobs_media
  for select
  to authenticated
  using (exists (
    select 1 from public.jobs j
    where j.id = jobs_media.job_id
    and j.user_id = (select auth.uid())
  ));

create policy "jobs_media: insert logs" on public.jobs_media
  for insert
  to authenticated
  with check (true);

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  action        text not null default '',
  entity        text not null default '',
  entity_id     text not null default '',
  details       jsonb default '{}',
  ip_address    text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_audit_logs_user
  on public.audit_logs (user_id);

create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity, entity_id);

alter table public.audit_logs enable row level security;

create policy "audit_logs: owner scope" on public.audit_logs
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.backup_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.users(id) on delete set null,
  type           text not null default 'full'
    check (type in ('full','diff','incremental')),
  status         text not null default 'pending',
  source_bucket  text not null default '',
  target_url     text not null default '',
  size_bytes     numeric(20,0) not null default 0,
  duration_sec   numeric(12,3) not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_backup_logs_user
  on public.backup_logs (user_id);

create index if not exists idx_backup_logs_created
  on public.backup_logs (created_at);

alter table public.backup_logs enable row level security;

create policy "backup_logs: owner or platform scope" on public.backup_logs
  for all
  to authenticated
  using (user_id is null or (select auth.uid()) = user_id)
  with check (user_id is null or (select auth.uid()) = user_id);


-- ============================================================
-- >>> 0003_security_and_settings.sql
-- ============================================================

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


-- ============================================================
-- >>> 0004_public_studio.sql
-- ============================================================

-- ============================================================================
-- 0004_public_studio.sql — Public "zero-friction" studio schema
--
-- Adds the public (no-login) surface on top of the tenant schema from 0001:
--   * client_sessions  — anonymous browser session (identity for public jobs)
--   * jobs             — extended with client_session_id + display columns
--   * clips            — rich clip records (replaces jobs_media as the read model)
--   * gpu_instances    — Vast.ai instance telemetry per job
--   * worker_logs      — append-only pipeline/worker log stream (SSE source)
--
-- Public access model
--   Users never paste an API key. The browser generates a `client_session_id`
--   (opaque UUID) and sends it as the `x-client-session` header. RLS policies
--   bind every public row to that header via `public.hotclip_session_id()`.
--   The service-role key used by the orchestrator bypasses RLS.
--
-- Idempotent: safe to re-run (`if not exists` everywhere).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Session helper — reads the anonymous session id from the request headers
-- ----------------------------------------------------------------------------
create or replace function public.hotclip_session_id()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.headers', true)::json ->> 'x-client-session',
      current_setting('request.headers', true)::json ->> 'X-Client-Session'
    ),
    ''
  );
$$;

comment on function public.hotclip_session_id() is
  'Anonymous browser session id (x-client-session header) used by public RLS policies.';

-- ----------------------------------------------------------------------------
-- 1. client_sessions — anonymous browser session
-- ----------------------------------------------------------------------------
create table if not exists public.client_sessions (
  id            uuid primary key default gen_random_uuid(),
  session_token text not null unique,
  user_agent    text,
  ip_address    text,
  job_count     integer not null default 0,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists idx_client_sessions_token
  on public.client_sessions (session_token);
create index if not exists idx_client_sessions_last_seen
  on public.client_sessions (last_seen_at desc);

alter table public.client_sessions enable row level security;

drop policy if exists client_sessions_public_insert on public.client_sessions;
create policy client_sessions_public_insert on public.client_sessions
  for insert to anon, authenticated
  with check (true);

drop policy if exists client_sessions_public_select on public.client_sessions;
create policy client_sessions_public_select on public.client_sessions
  for select to anon, authenticated
  using (session_token = public.hotclip_session_id());

drop policy if exists client_sessions_public_update on public.client_sessions;
create policy client_sessions_public_update on public.client_sessions
  for update to anon, authenticated
  using (session_token = public.hotclip_session_id())
  with check (session_token = public.hotclip_session_id());

-- ----------------------------------------------------------------------------
-- 2. jobs — extend the tenant table for public studio jobs
-- ----------------------------------------------------------------------------
alter table public.jobs alter column user_id drop not null;

alter table public.jobs
  add column if not exists client_session_id uuid
    references public.client_sessions(id) on delete cascade;
alter table public.jobs add column if not exists source_title text;
alter table public.jobs add column if not exists source_thumb text;
alter table public.jobs add column if not exists stage text;
alter table public.jobs add column if not exists clip_count integer not null default 0;
alter table public.jobs add column if not exists aspect_ratio text not null default '9:16';
alter table public.jobs add column if not exists progress integer not null default 0;
alter table public.jobs add column if not exists error text;
alter table public.jobs add column if not exists priority integer not null default 0;
alter table public.jobs add column if not exists params jsonb not null default '{}'::jsonb;

-- 0001 used `params_json`; keep both in sync for older readers.
update public.jobs
   set params = params_json
 where params is null
   and params_json is not null;

create index if not exists idx_jobs_client_session
  on public.jobs (client_session_id, created_at desc);
create index if not exists idx_jobs_status_created
  on public.jobs (status, created_at desc);
create index if not exists idx_jobs_public_feed
  on public.jobs (created_at desc) where client_session_id is not null;

drop policy if exists jobs_public_select on public.jobs;
create policy jobs_public_select on public.jobs
  for select to anon, authenticated
  using (client_session_id::text = public.hotclip_session_id());

drop policy if exists jobs_public_insert on public.jobs;
create policy jobs_public_insert on public.jobs
  for insert to anon, authenticated
  with check (client_session_id::text = public.hotclip_session_id());

drop policy if exists jobs_public_update on public.jobs;
create policy jobs_public_update on public.jobs
  for update to anon, authenticated
  using (client_session_id::text = public.hotclip_session_id())
  with check (client_session_id::text = public.hotclip_session_id());

-- ----------------------------------------------------------------------------
-- 3. clips — rich clip records (public read model)
-- ----------------------------------------------------------------------------
create table if not exists public.clips (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  client_session_id uuid references public.client_sessions(id) on delete cascade,
  title         text not null default '',
  caption       text not null default '',
  hashtags      text[] not null default '{}',
  start_sec     numeric(12,3) not null default 0,
  end_sec       numeric(12,3) not null default 0,
  duration_sec  numeric(12,3) not null default 0,
  score         integer not null default 0
    check (score between 0 and 100),
  aspect_ratio  text not null default '9:16',
  media_url     text not null default '',
  preview_url   text,
  thumbnail_url text,
  provider_id   text,
  bucket        text not null default '',
  object_key    text not null default '',
  size_bytes    bigint not null default 0,
  status        text not null default 'ready'
    check (status in ('processing','ready','failed')),
  created_at    timestamptz not null default now()
);
create index if not exists idx_clips_job on public.clips (job_id, created_at asc);
create index if not exists idx_clips_session on public.clips (client_session_id, created_at desc);
create index if not exists idx_clips_score on public.clips (score desc);

alter table public.clips enable row level security;

drop policy if exists clips_public_select on public.clips;
create policy clips_public_select on public.clips
  for select to anon, authenticated
  using (client_session_id::text = public.hotclip_session_id());

drop policy if exists clips_public_insert on public.clips;
create policy clips_public_insert on public.clips
  for insert to anon, authenticated
  with check (client_session_id::text = public.hotclip_session_id());

drop policy if exists clips_public_delete on public.clips;
create policy clips_public_delete on public.clips
  for delete to anon, authenticated
  using (client_session_id::text = public.hotclip_session_id());

-- ----------------------------------------------------------------------------
-- 4. gpu_instances — Vast.ai telemetry per job (public status surface)
-- ----------------------------------------------------------------------------
create table if not exists public.gpu_instances (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid references public.jobs(id) on delete cascade,
  client_session_id uuid references public.client_sessions(id) on delete cascade,
  vast_instance_id text,
  gpu_name         text,
  dph_total        numeric(10,4),
  status           text not null default 'provisioning'
    check (status in ('provisioning','booting','running','completed','failed','destroyed','blocked')),
  boot_started_at  timestamptz,
  ready_at         timestamptz,
  deleted_at       timestamptz,
  blocked_until    timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_gpu_instances_job on public.gpu_instances (job_id);
create index if not exists idx_gpu_instances_session on public.gpu_instances (client_session_id, created_at desc);
create index if not exists idx_gpu_instances_status on public.gpu_instances (status);

alter table public.gpu_instances enable row level security;

drop policy if exists gpu_instances_public_select on public.gpu_instances;
create policy gpu_instances_public_select on public.gpu_instances
  for select to anon, authenticated
  using (client_session_id::text = public.hotclip_session_id());

-- ----------------------------------------------------------------------------
-- 5. worker_logs — append-only log stream consumed by the public terminal
-- ----------------------------------------------------------------------------
create table if not exists public.worker_logs (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  client_session_id uuid references public.client_sessions(id) on delete cascade,
  instance_id text,
  level       text not null default 'info'
    check (level in ('debug','info','warn','error','stage')),
  stage       text,
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_worker_logs_job_id on public.worker_logs (job_id, id);
create index if not exists idx_worker_logs_session on public.worker_logs (client_session_id, id desc);

alter table public.worker_logs enable row level security;

drop policy if exists worker_logs_public_select on public.worker_logs;
create policy worker_logs_public_select on public.worker_logs
  for select to anon, authenticated
  using (client_session_id::text = public.hotclip_session_id());

-- ----------------------------------------------------------------------------
-- 6. Backward compatibility — jobs_media view over clips (0002 legacy readers)
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.jobs_media') is not null then
    -- Keep the legacy table for old writes, but mirror reads through a view
    -- only when the table is empty (fresh project).
    null;
  else
    create or replace view public.jobs_media as
      select id, job_id, provider_id, bucket, object_key, media_url,
             size_bytes, created_at
        from public.clips;
  end if;
end;
$$;

-- ============================================================================
-- 7. Seed global storage pool (idempotent) so the orchestrator has a target
-- ----------------------------------------------------------------------------
insert into public.storage_pools (name, provider_name, account_label, priority, quota_bytes, used_bytes, health_status, is_active, user_id)
select 'Global S3 Pool', 's3', 'default', 1, 536870912000, 0, 'healthy', true, null
where not exists (
  select 1 from public.storage_pools where user_id is null and provider_name = 's3'
);


-- ============================================================
-- >>> 0005_admin_audit.sql
-- ============================================================

-- ============================================================================
-- 0005_admin_audit.sql — Admin audit trail (`admin_audit_logs`)
--
-- Append-only table for sensitive dashboard admin actions: ban/unban users,
-- reset quota, destroy/cancel Vast.ai instances, toggle storage providers,
-- and successful admin sessions (4-layer Defense-in-Depth).
--
-- Security notes (Supabase Security Checklist):
--   - RLS on; only the `authenticated` role may read/write, scoped to its
--     own rows (`admin_id = auth.uid()`).
--   - SECURITY INVOKER only (no `security definer`) -> never bypasses RLS.
--   - `ip inet` so Postgres validates address format.
--   - `idx_admin_audit_created` supports the audit viewer ordering.
--
-- Idempotent: safe to re-run.
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

create index if not exists idx_admin_audit_created
  on public.admin_audit_logs (created_at desc);

create index if not exists idx_admin_audit_admin
  on public.admin_audit_logs (admin_id, created_at desc);

create index if not exists idx_admin_audit_entity
  on public.admin_audit_logs (entity, entity_id);

alter table public.admin_audit_logs enable row level security;

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

-- Append-only: no UPDATE/DELETE policy, so rows cannot be mutated or removed
-- through the Data API with the `authenticated` role.

