-- Milestone 3: content planning — product facts, content projects, versioned storyboards,
-- scenes and claims. Every claim must cite a product fact before a storyboard can be approved
-- (checked in src/features/content/validate.ts); an approved storyboard is locked here in SQL.

-- ---------------------------------------------------------------------------
-- Product facts: statements about a product that scripts may use (e.g. "แบตเตอรี่ 20 ชั่วโมง").
-- Built-in product fields (name, price, …) are facts too and are referenced by field name.
-- ---------------------------------------------------------------------------

create table public.product_facts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  value text not null check (char_length(value) between 1 and 300),
  -- Same vocabulary as products.provenance.
  status text not null default 'user_provided' check (status in ('verified_source', 'user_provided', 'imported_csv', 'ai_estimate')),
  source_url text check (char_length(source_url) <= 2000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_facts_product_idx on public.product_facts (product_id, position, created_at);

create trigger product_facts_updated_at before update on public.product_facts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Content projects and storyboards
-- ---------------------------------------------------------------------------

create table public.content_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  platform text not null check (platform in ('tiktok', 'reels', 'shorts')),
  target_duration_s integer not null check (target_duration_s between 10 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_projects_owner_updated_idx on public.content_projects (owner_id, updated_at desc);
create index content_projects_product_idx on public.content_projects (product_id);

create trigger content_projects_updated_at before update on public.content_projects
  for each row execute function public.set_updated_at();

create table public.storyboards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.content_projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version integer not null check (version >= 1),
  template_id text not null check (char_length(template_id) <= 60),
  template_version integer not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  hook text not null default '' check (char_length(hook) <= 300),
  caption text not null default '' check (char_length(caption) <= 2200),
  cta text not null default '' check (char_length(cta) <= 300),
  -- Affiliate disclosure is required and comes from the template; the UI does not let users blank it.
  disclosure text not null check (char_length(disclosure) between 1 and 300),
  -- Facts as they were when approved, so later fact edits don't silently change an approved script.
  approved_snapshot jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version),
  check ((status = 'approved') = (approved_at is not null))
);

create index storyboards_owner_updated_idx on public.storyboards (owner_id, updated_at desc);

create trigger storyboards_updated_at before update on public.storyboards
  for each row execute function public.set_updated_at();

create table public.storyboard_scenes (
  id uuid primary key default gen_random_uuid(),
  storyboard_id uuid not null references public.storyboards (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position integer not null check (position >= 0),
  -- Template role of the scene, e.g. hook / problem / feature / price / cta.
  kind text not null check (char_length(kind) <= 40),
  narration text not null default '' check (char_length(narration) <= 1000),
  on_screen_text text not null default '' check (char_length(on_screen_text) <= 200),
  visual_note text not null default '' check (char_length(visual_note) <= 500),
  -- Who wrote the current text: template, user (edited) or ai (LLM, needs review).
  text_origin text not null default 'template' check (text_origin in ('template', 'user', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index storyboard_scenes_storyboard_idx on public.storyboard_scenes (storyboard_id, position);

create trigger storyboard_scenes_updated_at before update on public.storyboard_scenes
  for each row execute function public.set_updated_at();

create table public.scene_claims (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.storyboard_scenes (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  -- The fact this claim relies on: a product_facts row, or a built-in product field. Never both.
  -- A fact in use cannot be deleted on its own (remove the claim first). Deferred to commit so a
  -- product delete, which cascades to both facts and (more deeply) claims, can finish first.
  fact_id uuid references public.product_facts (id) on delete no action deferrable initially deferred,
  product_field text check (product_field in ('name', 'price', 'category', 'marketplace', 'description')),
  check (fact_id is null or product_field is null),
  review_status text not null default 'pending' check (review_status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scene_claims_scene_idx on public.scene_claims (scene_id, created_at);
create index scene_claims_fact_idx on public.scene_claims (fact_id) where fact_id is not null;

create trigger scene_claims_updated_at before update on public.scene_claims
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Approval lock: nothing in an approved storyboard can change. Editing means a new version.
-- Cascade deletes still work: once the parent row is gone the lookup finds nothing.
-- ---------------------------------------------------------------------------

create or replace function public.storyboard_is_approved(sb uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.storyboards s where s.id = sb and s.status = 'approved');
$$;

create or replace function public.lock_approved_storyboard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'approved' then
    raise exception 'storyboard is approved and locked; create a new version to edit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger storyboards_lock before update on public.storyboards
  for each row execute function public.lock_approved_storyboard();

create or replace function public.lock_approved_scene()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sb uuid;
begin
  sb := case when tg_op = 'DELETE' then old.storyboard_id else new.storyboard_id end;
  if public.storyboard_is_approved(sb) or (tg_op = 'UPDATE' and public.storyboard_is_approved(old.storyboard_id)) then
    raise exception 'storyboard is approved and locked; create a new version to edit' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger storyboard_scenes_lock before insert or update or delete on public.storyboard_scenes
  for each row execute function public.lock_approved_scene();

create or replace function public.lock_approved_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sc uuid;
begin
  sc := case when tg_op = 'DELETE' then old.scene_id else new.scene_id end;
  if exists (
    select 1 from public.storyboard_scenes s
    where s.id in (sc, case when tg_op = 'UPDATE' then old.scene_id end)
      and public.storyboard_is_approved(s.storyboard_id)
  ) then
    raise exception 'storyboard is approved and locked; create a new version to edit' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger scene_claims_lock before insert or update or delete on public.scene_claims
  for each row execute function public.lock_approved_claim();

-- ---------------------------------------------------------------------------
-- RLS: owner-only, and children must belong to the caller's parent rows.
-- ---------------------------------------------------------------------------

alter table public.product_facts enable row level security;
alter table public.content_projects enable row level security;
alter table public.storyboards enable row level security;
alter table public.storyboard_scenes enable row level security;
alter table public.scene_claims enable row level security;

create policy "facts: owner selects" on public.product_facts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "facts: owner inserts" on public.product_facts
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "facts: owner updates" on public.product_facts
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "facts: owner deletes" on public.product_facts
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "projects: owner selects" on public.content_projects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "projects: owner inserts" on public.content_projects
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "projects: owner updates" on public.content_projects
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "projects: owner deletes" on public.content_projects
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "storyboards: owner selects" on public.storyboards
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "storyboards: owner inserts" on public.storyboards
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.content_projects c where c.id = project_id and c.owner_id = (select auth.uid()))
  );
create policy "storyboards: owner updates" on public.storyboards
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.content_projects c where c.id = project_id and c.owner_id = (select auth.uid()))
  );
create policy "storyboards: owner deletes" on public.storyboards
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "scenes: owner selects" on public.storyboard_scenes
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "scenes: owner inserts" on public.storyboard_scenes
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboards s where s.id = storyboard_id and s.owner_id = (select auth.uid()))
  );
create policy "scenes: owner updates" on public.storyboard_scenes
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboards s where s.id = storyboard_id and s.owner_id = (select auth.uid()))
  );
create policy "scenes: owner deletes" on public.storyboard_scenes
  for delete to authenticated using (owner_id = (select auth.uid()));

-- A claim may only cite a fact of the caller's own (any) product; the app restricts it to the
-- storyboard's product.
create policy "claims: owner selects" on public.scene_claims
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "claims: owner inserts" on public.scene_claims
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboard_scenes s where s.id = scene_id and s.owner_id = (select auth.uid()))
    and (fact_id is null or exists (select 1 from public.product_facts f where f.id = fact_id and f.owner_id = (select auth.uid())))
  );
create policy "claims: owner updates" on public.scene_claims
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboard_scenes s where s.id = scene_id and s.owner_id = (select auth.uid()))
    and (fact_id is null or exists (select 1 from public.product_facts f where f.id = fact_id and f.owner_id = (select auth.uid())))
  );
create policy "claims: owner deletes" on public.scene_claims
  for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.product_facts, public.content_projects, public.storyboards, public.storyboard_scenes, public.scene_claims from anon;
grant select, insert, update, delete on public.product_facts, public.content_projects, public.storyboards, public.storyboard_scenes, public.scene_claims to authenticated;
