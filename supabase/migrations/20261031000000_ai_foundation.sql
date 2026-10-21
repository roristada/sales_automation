-- AI-1 (docs/AI_VIDEO_PLAN.md): OpenRouter settings and a log of every paid AI call. AI spend
-- counts toward the existing daily/monthly caps (spend_summary).

-- ---------------------------------------------------------------------------
-- Settings: model per task, per-video cap, confirm threshold
-- ---------------------------------------------------------------------------

create table public.ai_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- { "<task>": "<OpenRouter model id>" }; missing task = the default in code.
  models jsonb not null default '{}' check (jsonb_typeof(models) = 'object' and pg_column_size(models) <= 4000),
  -- NULL = no cap per video.
  per_video_cap_thb numeric(12, 2) default 150 check (per_video_cap_thb >= 0),
  -- A single job estimated above this asks for confirmation first.
  confirm_over_thb numeric(12, 2) not null default 30 check (confirm_over_thb >= 0),
  updated_at timestamptz not null default now()
);

create trigger ai_settings_updated_at before update on public.ai_settings
  for each row execute function public.set_updated_at();

alter table public.ai_settings enable row level security;

create policy "ai settings: owner selects" on public.ai_settings
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "ai settings: owner inserts" on public.ai_settings
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "ai settings: owner updates" on public.ai_settings
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Supabase grants every privilege on new tables to anon/authenticated by default.
revoke all on public.ai_settings from anon, authenticated;
grant select, insert, update on public.ai_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Request log
-- ---------------------------------------------------------------------------

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task text not null check (task in ('test', 'script', 'extract', 'scene_prompt', 'review', 'video_product', 'video_lifestyle', 'tts')),
  model text not null check (char_length(model) between 1 and 200),
  status text not null check (status in ('succeeded', 'failed')),
  -- OpenRouter's generation / job id, for looking the call up on openrouter.ai.
  generation_id text check (char_length(generation_id) <= 200),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  video_seconds real check (video_seconds >= 0),
  -- Actual cost as reported by OpenRouter (usage.cost, in USD credits), and in THB at the rate used.
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  cost_thb numeric(12, 4) not null default 0 check (cost_thb >= 0),
  error text check (char_length(error) <= 1000),
  product_id uuid references public.products (id) on delete set null,
  storyboard_id uuid references public.storyboards (id) on delete set null,
  created_at timestamptz not null default now()
);

create index ai_requests_owner_created_idx on public.ai_requests (owner_id, created_at desc);
create index ai_requests_storyboard_idx on public.ai_requests (storyboard_id) where storyboard_id is not null;

alter table public.ai_requests enable row level security;

-- The app logs calls with the owner's session; the worker (service role) logs video jobs.
-- An entry is never edited or deleted by the owner: it's the spending record.
create policy "ai requests: owner selects" on public.ai_requests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "ai requests: owner inserts" on public.ai_requests
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and (product_id is null or exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())))
    and (storyboard_id is null or exists (select 1 from public.storyboards s where s.id = storyboard_id and s.owner_id = (select auth.uid())))
  );

revoke all on public.ai_requests from anon, authenticated;
grant select, insert on public.ai_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Spend: usage events + AI requests
-- ---------------------------------------------------------------------------

create or replace function public.spend_summary(owner uuid default null)
returns table (today_thb numeric, month_thb numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with spend as (
    select created_at, est_cost_thb as thb from public.usage_events
    where owner_id = coalesce(owner, auth.uid()) and created_at >= now() - interval '32 days'
    union all
    select created_at, cost_thb from public.ai_requests
    where owner_id = coalesce(owner, auth.uid()) and created_at >= now() - interval '32 days'
  )
  select
    coalesce(sum(thb) filter (where (created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date), 0),
    coalesce(sum(thb) filter (where date_trunc('month', created_at at time zone 'Asia/Bangkok') = date_trunc('month', now() at time zone 'Asia/Bangkok')), 0)
  from spend;
$$;

revoke all on function public.spend_summary(uuid) from public, anon;
grant execute on function public.spend_summary(uuid) to authenticated, service_role;
