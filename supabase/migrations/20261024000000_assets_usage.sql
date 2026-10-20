-- Milestone 5: asset library (own images/clips with licensing), per-scene media, usage log and
-- spending limits.

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Optional: the product the asset shows. Kept when the product is deleted.
  product_id uuid references public.products (id) on delete set null,
  kind text not null check (kind in ('image', 'video')),
  -- Written by the upload route after the file is stored.
  storage_key text not null,
  name text not null check (char_length(name) between 1 and 200),
  mime text not null check (char_length(mime) <= 100),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer,
  height integer,
  duration_s real,
  -- Where it came from and what we may do with it (design.md §9.7: never imply it's safe).
  source text not null check (source in ('own', 'stock', 'brand_supplied', 'ai_generated', 'product_page', 'other')),
  source_url text check (char_length(source_url) <= 2000),
  license text not null default 'unknown' check (license in ('own_work', 'commercial_license', 'cc_by', 'cc0', 'brand_permission', 'non_commercial', 'unknown')),
  attribution text check (char_length(attribution) <= 300),
  ai_generated boolean not null default false,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, sha256)
);

create index assets_owner_created_idx on public.assets (owner_id, created_at desc);
create index assets_product_idx on public.assets (product_id) where product_id is not null;

create trigger assets_updated_at before update on public.assets
  for each row execute function public.set_updated_at();

alter table public.assets enable row level security;

create policy "assets: owner selects" on public.assets
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "assets: owner inserts" on public.assets
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and (product_id is null or exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())))
  );
create policy "assets: owner updates" on public.assets
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and (product_id is null or exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())))
  );
create policy "assets: owner deletes" on public.assets
  for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.assets from anon;
grant select, insert, update, delete on public.assets to authenticated;

-- File facts are set by the server at upload; users may only edit descriptive fields.
revoke update on public.assets from authenticated;
grant update (product_id, name, source, source_url, license, attribution, ai_generated, notes) on public.assets to authenticated;

-- A scene may show one asset instead of the product photo. An asset in use can't be deleted
-- (remove it from the scene first; approved scripts keep theirs). Deferred so deleting a whole
-- account (assets and scenes cascade together) still works.
alter table public.storyboard_scenes
  add column asset_id uuid references public.assets (id) on delete no action deferrable initially deferred;

create index storyboard_scenes_asset_idx on public.storyboard_scenes (asset_id) where asset_id is not null;

-- The scene's asset must be the caller's own.
drop policy "scenes: owner inserts" on public.storyboard_scenes;
drop policy "scenes: owner updates" on public.storyboard_scenes;
create policy "scenes: owner inserts" on public.storyboard_scenes
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboards s where s.id = storyboard_id and s.owner_id = (select auth.uid()))
    and (asset_id is null or exists (select 1 from public.assets a where a.id = asset_id and a.owner_id = (select auth.uid())))
  );
create policy "scenes: owner updates" on public.storyboard_scenes
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboards s where s.id = storyboard_id and s.owner_id = (select auth.uid()))
    and (asset_id is null or exists (select 1 from public.assets a where a.id = asset_id and a.owner_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- Usage and spending limits
-- ---------------------------------------------------------------------------

create table public.usage_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- e.g. render (Remotion, local), tts_google, llm_anthropic
  provider text not null check (char_length(provider) <= 60),
  units numeric(14, 3) not null check (units >= 0),
  unit text not null check (char_length(unit) <= 30),
  -- Estimated cost in THB from the rate table in code at the time of use.
  est_cost_thb numeric(12, 4) not null default 0 check (est_cost_thb >= 0),
  render_job_id uuid references public.render_jobs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index usage_events_owner_created_idx on public.usage_events (owner_id, created_at desc);

alter table public.usage_events enable row level security;

-- Written by the worker (service role) only; owners read.
create policy "usage: owner selects" on public.usage_events
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.usage_events from anon;
grant select on public.usage_events to authenticated;

create table public.spending_limits (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- NULL = no cap. Bangkok calendar day / month.
  daily_thb numeric(12, 2) check (daily_thb >= 0),
  monthly_thb numeric(12, 2) check (monthly_thb >= 0),
  updated_at timestamptz not null default now()
);

create trigger spending_limits_updated_at before update on public.spending_limits
  for each row execute function public.set_updated_at();

alter table public.spending_limits enable row level security;

create policy "limits: owner selects" on public.spending_limits
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "limits: owner inserts" on public.spending_limits
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "limits: owner updates" on public.spending_limits
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.spending_limits from anon;
grant select, insert, update on public.spending_limits to authenticated;

-- Spend so far today and this month (Asia/Bangkok), for the caller or — service role — any owner.
create or replace function public.spend_summary(owner uuid default null)
returns table (today_thb numeric, month_thb numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(est_cost_thb) filter (where (created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date), 0),
    coalesce(sum(est_cost_thb) filter (where date_trunc('month', created_at at time zone 'Asia/Bangkok') = date_trunc('month', now() at time zone 'Asia/Bangkok')), 0)
  from public.usage_events
  where owner_id = coalesce(owner, auth.uid())
    and created_at >= now() - interval '32 days';
$$;

revoke all on function public.spend_summary(uuid) from public, anon;
grant execute on function public.spend_summary(uuid) to authenticated, service_role;
