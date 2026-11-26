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
