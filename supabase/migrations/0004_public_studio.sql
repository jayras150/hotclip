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

-- ----------------------------------------------------------------------------
-- 7. Seed global storage pool (idempotent) so the orchestrator has a target
-- ----------------------------------------------------------------------------
insert into public.storage_pools (name, provider_name, account_label, priority, quota_bytes, used_bytes, health_status, is_active, user_id)
select 'Global S3 Pool', 's3', 'default', 1, 536870912000, 0, 'healthy', true, null
where not exists (
  select 1 from public.storage_pools where user_id is null and provider_name = 's3'
);
