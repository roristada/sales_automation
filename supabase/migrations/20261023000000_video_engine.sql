-- Milestone 4: render jobs (Postgres queue) and their outputs.
-- The web app only enqueues and reads; the render worker (worker/, service role) claims jobs
-- with FOR UPDATE SKIP LOCKED, renders, stores files and writes the outputs row.

create table public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storyboard_id uuid not null references public.storyboards (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'canceled')),
  -- 0..1 and a short machine stage name (bundling, rendering, probing, …) for the UI.
  progress real not null default 0 check (progress between 0 and 1),
  stage text,
  attempt integer not null default 0,
  max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  -- Render settings snapshot: size, fps, tts provider, renderer version.
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  error_code text,
  error_message text check (char_length(error_message) <= 2000),
  locked_by text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index render_jobs_owner_created_idx on public.render_jobs (owner_id, created_at desc);
create index render_jobs_storyboard_idx on public.render_jobs (storyboard_id, created_at desc);
create index render_jobs_queue_idx on public.render_jobs (created_at) where status in ('queued', 'processing');
-- Idempotency: at most one active job per storyboard (double clicks can't queue twice).
create unique index render_jobs_one_active_per_storyboard on public.render_jobs (storyboard_id) where status in ('queued', 'processing');

create trigger render_jobs_updated_at before update on public.render_jobs
  for each row execute function public.set_updated_at();

create table public.render_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.render_jobs (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Keys in the storage adapter (local disk now; object storage later).
  video_key text not null,
  srt_key text,
  vtt_key text,
  thumbnail_key text,
  duration_s real,
  size_bytes bigint,
  -- ffprobe facts and the QA checks derived from them.
  probe jsonb,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.render_jobs enable row level security;
alter table public.render_outputs enable row level security;

create policy "render jobs: owner selects" on public.render_jobs
  for select to authenticated using (owner_id = (select auth.uid()));
-- Only approved storyboards can be queued (PLAN.md M3/M4: approve before render).
create policy "render jobs: owner queues approved storyboards" on public.render_jobs
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and status = 'queued'
    and attempt = 0
    and exists (
      select 1 from public.storyboards s
      where s.id = storyboard_id and s.owner_id = (select auth.uid()) and s.status = 'approved'
    )
  );

create policy "render outputs: owner selects" on public.render_outputs
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.render_jobs, public.render_outputs from anon;
grant select, insert on public.render_jobs to authenticated;
grant select on public.render_outputs to authenticated;

-- Owner cancels a job that hasn't finished. The worker checks status between stages.
create or replace function public.cancel_render_job(job uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.render_jobs
     set status = 'canceled', finished_at = now(), stage = null
   where id = job and owner_id = auth.uid() and status in ('queued', 'processing');
  return found;
end;
$$;

revoke all on function public.cancel_render_job(uuid) from public, anon;
grant execute on function public.cancel_render_job(uuid) to authenticated;

-- Worker: claim the oldest queued job, or a processing job whose worker died (stale lock),
-- if it still has attempts left. Service role only.
create or replace function public.claim_render_job(worker text, stale_after interval default interval '15 minutes')
returns setof public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.render_jobs j
     set status = 'processing',
         attempt = j.attempt + 1,
         locked_by = worker,
         locked_at = now(),
         started_at = coalesce(j.started_at, now()),
         progress = 0,
         stage = 'claimed',
         error_code = null,
         error_message = null
   where j.id = (
     select q.id from public.render_jobs q
      where q.attempt < q.max_attempts
        and (q.status = 'queued' or (q.status = 'processing' and q.locked_at < now() - stale_after))
      order by q.created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;

revoke all on function public.claim_render_job(text, interval) from public, anon, authenticated;
grant execute on function public.claim_render_job(text, interval) to service_role;

-- A stale processing job that used all attempts is failed rather than left hanging.
create or replace function public.fail_exhausted_render_jobs(stale_after interval default interval '15 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.render_jobs
     set status = 'failed', finished_at = now(), error_code = 'worker_lost',
         error_message = 'ตัว render หยุดทำงานระหว่างทำงานและลองครบจำนวนครั้งแล้ว'
   where status = 'processing' and attempt >= max_attempts and locked_at < now() - stale_after;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.fail_exhausted_render_jobs(interval) from public, anon, authenticated;
grant execute on function public.fail_exhausted_render_jobs(interval) to service_role;
