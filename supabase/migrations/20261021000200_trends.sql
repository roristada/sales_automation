-- Milestone 2: trend signals.
-- Google Trends values are relative interest (0–100) within ONE query/export, so every import
-- is kept as its own snapshot; series from different imports are never merged or compared.

create type public.trend_source as enum ('google_trends_csv', 'google_trends_api');

create table public.trend_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source public.trend_source not null,
  file_name text check (char_length(file_name) <= 255),
  -- e.g. "All categories" as written in the export header; NULL when absent.
  category text check (char_length(category) <= 200),
  granularity text not null check (granularity in ('day', 'week', 'month')),
  period_start date not null,
  period_end date not null,
  keywords text[] not null check (cardinality(keywords) between 1 and 5),
  point_count integer not null check (point_count > 0),
  -- When the data was taken from the source (file date for CSV exports).
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index trend_imports_owner_created_idx on public.trend_imports (owner_id, created_at desc);

create table public.trend_observations (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.trend_imports (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword text not null check (char_length(keyword) between 1 and 200),
  region text check (char_length(region) <= 120),
  period_start date not null,
  value numeric(5, 1) not null check (value between 0 and 100),
  -- Google shows "<1" for tiny non-zero interest; stored as value 0 + this flag, never as a guess.
  below_one boolean not null default false,
  value_unit text not null default 'relative_interest_0_100',
  unique (import_id, keyword, period_start)
);

create index trend_observations_owner_keyword_idx on public.trend_observations (owner_id, keyword, period_start);

-- Which trend keyword the user chose for a product (separate table so linking does not touch
-- products.updated_at, which is the freshness fallback).
create table public.product_trend_links (
  product_id uuid primary key references public.products (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword text not null check (char_length(keyword) between 1 and 200),
  created_at timestamptz not null default now()
);

alter table public.trend_imports enable row level security;
alter table public.trend_observations enable row level security;
alter table public.product_trend_links enable row level security;

create policy "trend imports: owner selects" on public.trend_imports
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "trend imports: owner inserts" on public.trend_imports
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "trend imports: owner deletes" on public.trend_imports
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "trend observations: owner selects" on public.trend_observations
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "trend observations: owner inserts" on public.trend_observations
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.trend_imports i where i.id = import_id and i.owner_id = (select auth.uid()))
  );

create policy "trend links: owner selects" on public.product_trend_links
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "trend links: owner inserts" on public.product_trend_links
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "trend links: owner updates" on public.product_trend_links
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "trend links: owner deletes" on public.product_trend_links
  for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.trend_imports, public.trend_observations, public.product_trend_links from anon;
grant select, insert, delete on public.trend_imports to authenticated;
grant select, insert on public.trend_observations to authenticated;
grant select, insert, update, delete on public.product_trend_links to authenticated;
