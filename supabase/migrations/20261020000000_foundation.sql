-- Milestone 1 foundation: profiles, products, price history, CSV import batches.
-- Every user-owned row carries owner_id and is protected by RLS (owner_id = auth.uid()).

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles: owner reads" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: owner updates" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

-- Where the product record came from. New marketplace adapters add a value here.
create type public.product_source as enum ('manual', 'csv', 'shopee_affiliate', 'tiktok_shop');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source public.product_source not null,
  -- The product's ID at the source (e.g. Shopee item id). Null for manual entries.
  source_product_id text check (char_length(source_product_id) <= 200),
  name text not null check (char_length(name) between 1 and 300),
  product_url text check (char_length(product_url) <= 2000),
  affiliate_url text check (char_length(affiliate_url) <= 2000),
  -- Normalised product_url used for duplicate detection (lowercased host, no query/fragment).
  url_key text,
  -- Marketplace the product is sold on (e.g. "shopee"), independent of how it entered the system.
  marketplace text check (char_length(marketplace) <= 60),
  category text check (char_length(category) <= 120),
  -- Unknown values stay NULL, never 0.
  price numeric(14, 2) check (price >= 0),
  currency char(3) not null default 'THB',
  commission_rate numeric(6, 3) check (commission_rate >= 0 and commission_rate <= 100),
  commission_amount numeric(14, 2) check (commission_amount >= 0),
  image_url text check (char_length(image_url) <= 2000),
  description text check (char_length(description) <= 5000),
  notes text check (char_length(notes) <= 2000),
  -- Per-field data status: {"price": "imported_csv", "commission_rate": "user_provided", ...}.
  -- Allowed statuses: verified_source, user_provided, imported_csv, ai_estimate.
  -- "unavailable" is implied by a NULL value; "stale" is derived from retrieved_at.
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  -- When the source data was retrieved/last updated at the source.
  retrieved_at timestamptz,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index products_owner_source_pid_key
  on public.products (owner_id, source, source_product_id) where source_product_id is not null;
create unique index products_owner_url_key
  on public.products (owner_id, url_key) where url_key is not null;
create index products_owner_created_idx on public.products (owner_id, created_at desc);

create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

create policy "products: owner selects" on public.products
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "products: owner inserts" on public.products
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "products: owner updates" on public.products
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "products: owner deletes" on public.products
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Price / commission history (append-only snapshot when values change)
-- ---------------------------------------------------------------------------

create table public.product_price_history (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  price numeric(14, 2),
  commission_rate numeric(6, 3),
  commission_amount numeric(14, 2),
  source public.product_source not null,
  recorded_at timestamptz not null default now()
);

create index product_price_history_product_idx on public.product_price_history (product_id, recorded_at desc);

alter table public.product_price_history enable row level security;

create policy "price history: owner selects" on public.product_price_history
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "price history: owner inserts" on public.product_price_history
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );

-- Record a snapshot whenever price or commission changes (or on first insert with any value).
create or replace function public.record_price_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and (new.price is not null or new.commission_rate is not null or new.commission_amount is not null))
     or (tg_op = 'UPDATE' and (
          new.price is distinct from old.price
          or new.commission_rate is distinct from old.commission_rate
          or new.commission_amount is distinct from old.commission_amount)) then
    insert into public.product_price_history (product_id, owner_id, price, commission_rate, commission_amount, source)
    values (new.id, new.owner_id, new.price, new.commission_rate, new.commission_amount, new.source);
  end if;
  return new;
end;
$$;

create trigger products_price_history after insert or update on public.products
  for each row execute function public.record_price_history();

-- ---------------------------------------------------------------------------
-- CSV import batches and rejected rows
-- ---------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_name text not null check (char_length(file_name) <= 255),
  duplicate_mode text not null check (duplicate_mode in ('skip', 'update')),
  column_mapping jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  duplicate_count integer not null default 0,
  failed_count integer not null default 0,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index import_batches_owner_created_idx on public.import_batches (owner_id, created_at desc);

alter table public.products
  add constraint products_import_batch_fk foreign key (import_batch_id)
  references public.import_batches (id) on delete set null;

alter table public.import_batches enable row level security;

create policy "import batches: owner selects" on public.import_batches
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "import batches: owner inserts" on public.import_batches
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "import batches: owner updates" on public.import_batches
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "import batches: owner deletes" on public.import_batches
  for delete to authenticated using (owner_id = (select auth.uid()));

create table public.import_row_errors (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  errors jsonb not null
);

create index import_row_errors_batch_idx on public.import_row_errors (batch_id, row_number);

alter table public.import_row_errors enable row level security;

create policy "import errors: owner selects" on public.import_row_errors
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "import errors: owner inserts" on public.import_row_errors
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.import_batches b where b.id = batch_id and b.owner_id = (select auth.uid()))
  );

-- Explicit grants (anon gets nothing).
revoke all on public.profiles, public.products, public.product_price_history,
  public.import_batches, public.import_row_errors from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.products, public.import_batches to authenticated;
grant select, insert on public.product_price_history, public.import_row_errors to authenticated;
