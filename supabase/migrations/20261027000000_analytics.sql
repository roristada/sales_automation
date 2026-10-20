-- Milestone 7: analytics from CSV exports. Two kinds of file:
-- - post metrics (TikTok Studio / YouTube Studio / Instagram insights exports, or a hand-made
--   sheet): views, likes, … per post, as of a date. Matched to a publication by post URL/ID.
-- - affiliate conversions (Shopee Affiliate conversion report): orders and commission. Matched to
--   a publication only by its tracking code in a Sub_id column. Anything unmatched still counts in
--   totals but is never attributed to a video (PLAN.md M7: keep attributed apart from totals).

-- Each publication gets a short code for the affiliate network's Sub_id field.
alter table public.publications
  add column tracking_code text not null default ('sa' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  check (tracking_code ~ '^[a-z0-9]{6,20}$');
create unique index publications_tracking_code_unique on public.publications (owner_id, tracking_code);

create table public.performance_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('post_metrics', 'affiliate_conversions')),
  file_name text not null check (char_length(file_name) between 1 and 255),
  total_rows integer not null default 0,
  saved_rows integer not null default 0,
  matched_rows integer not null default 0,
  failed_rows integer not null default 0,
  -- First row errors, for the import list: [{ line, message }].
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  created_at timestamptz not null default now()
);

create index performance_imports_owner_created_idx on public.performance_imports (owner_id, created_at desc);

create table public.post_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  import_id uuid not null references public.performance_imports (id) on delete cascade,
  publication_id uuid references public.publications (id) on delete set null,
  -- Normalised post identity, e.g. "tiktok:7312…", "shorts:abc", "reels:Cx…", or "id:<raw id>".
  post_key text not null check (char_length(post_key) between 1 and 300),
  post_url text check (char_length(post_url) <= 2000),
  title text check (char_length(title) <= 300),
  -- Totals as of this day (exports are cumulative). NULL = the file had no such column/value.
  captured_on date not null,
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  saves bigint check (saves >= 0),
  watch_time_s numeric(14, 1) check (watch_time_s >= 0),
  avg_watch_s numeric(10, 2) check (avg_watch_s >= 0),
  created_at timestamptz not null default now(),
  -- Re-importing the same day's numbers replaces them.
  unique (owner_id, post_key, captured_on)
);

create index post_metrics_publication_idx on public.post_metrics (publication_id, captured_on desc) where publication_id is not null;
create index post_metrics_import_idx on public.post_metrics (import_id);

create table public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  import_id uuid not null references public.performance_imports (id) on delete cascade,
  publication_id uuid references public.publications (id) on delete set null,
  network text not null default 'shopee' check (network in ('shopee', 'other')),
  order_id text not null check (char_length(order_id) between 1 and 100),
  -- Distinguishes items of one order (item id, else item name, else '').
  item_key text not null default '' check (char_length(item_key) <= 300),
  item_name text check (char_length(item_name) <= 300),
  status text not null check (status in ('completed', 'pending', 'cancelled', 'unknown')),
  raw_status text check (char_length(raw_status) <= 100),
  ordered_at timestamptz,
  order_value_thb numeric(14, 2) check (order_value_thb >= 0),
  commission_thb numeric(14, 2),
  sub_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Re-importing a later report updates the order (e.g. pending → completed).
  unique (owner_id, network, order_id, item_key)
);

create index affiliate_conversions_publication_idx on public.affiliate_conversions (publication_id) where publication_id is not null;
create index affiliate_conversions_import_idx on public.affiliate_conversions (import_id);

create trigger affiliate_conversions_updated_at before update on public.affiliate_conversions
  for each row execute function public.set_updated_at();

alter table public.performance_imports enable row level security;
alter table public.post_metrics enable row level security;
alter table public.affiliate_conversions enable row level security;

create policy "performance imports: owner selects" on public.performance_imports
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "performance imports: owner inserts" on public.performance_imports
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "performance imports: owner updates" on public.performance_imports
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "performance imports: owner deletes" on public.performance_imports
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Rows must hang off the caller's own import and (if matched) the caller's own publication.
create policy "post metrics: owner selects" on public.post_metrics
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "post metrics: owner inserts" on public.post_metrics
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.performance_imports i where i.id = import_id and i.owner_id = (select auth.uid()) and i.kind = 'post_metrics')
    and (publication_id is null or exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = (select auth.uid())))
  );
create policy "post metrics: owner updates" on public.post_metrics
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.performance_imports i where i.id = import_id and i.owner_id = (select auth.uid()) and i.kind = 'post_metrics')
    and (publication_id is null or exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = (select auth.uid())))
  );
create policy "post metrics: owner deletes" on public.post_metrics
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "conversions: owner selects" on public.affiliate_conversions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "conversions: owner inserts" on public.affiliate_conversions
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.performance_imports i where i.id = import_id and i.owner_id = (select auth.uid()) and i.kind = 'affiliate_conversions')
    and (publication_id is null or exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = (select auth.uid())))
  );
create policy "conversions: owner updates" on public.affiliate_conversions
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.performance_imports i where i.id = import_id and i.owner_id = (select auth.uid()) and i.kind = 'affiliate_conversions')
    and (publication_id is null or exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = (select auth.uid())))
  );
create policy "conversions: owner deletes" on public.affiliate_conversions
  for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.performance_imports, public.post_metrics, public.affiliate_conversions from anon;
grant select, insert, update, delete on public.performance_imports, public.post_metrics, public.affiliate_conversions to authenticated;

-- Estimated spend per content project (all its renders), for cost per video.
create or replace function public.project_costs()
returns table (project_id uuid, cost_thb numeric, renders bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.project_id, coalesce(sum(u.est_cost_thb), 0), count(distinct j.id)
    from public.usage_events u
    join public.render_jobs j on j.id = u.render_job_id
    join public.storyboards s on s.id = j.storyboard_id
   where u.owner_id = (select auth.uid())
   group by s.project_id;
$$;

revoke all on function public.project_costs() from public, anon;
grant execute on function public.project_costs() to authenticated;
