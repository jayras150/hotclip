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
