-- Milestone 8: monitoring. Render workers report a heartbeat so the app can tell "queued
-- because the worker isn't running" from "queued behind another job", and /api/health can
-- report it to an uptime monitor.

create table public.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) <= 200),
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  busy boolean not null default false
);

-- Written by the worker (service role) only. Rows name the host, so users never read them
-- directly; worker_status() exposes just whether one is alive.
alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from anon, authenticated;

create or replace function public.worker_status(alive_within interval default interval '45 seconds')
returns table (online integer, busy integer, last_seen timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where h.last_seen > now() - alive_within)::integer,
         count(*) filter (where h.last_seen > now() - alive_within and h.busy)::integer,
         max(h.last_seen)
    from public.worker_heartbeats h;
$$;

revoke all on function public.worker_status(interval) from public;
grant execute on function public.worker_status(interval) to anon, authenticated, service_role;
