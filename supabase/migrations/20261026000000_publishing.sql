-- Milestone 6: publishing. No platform API is connected yet (no OAuth / app review), so a
-- publication is a manual record: the user downloads the export pack, posts it themselves and
-- pastes back the post URL. The app never claims a post exists without that URL (design.md §9.8).

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The exact rendered file being posted. storyboard/project/disclosure are derived from it by
  -- the trigger below and can't be set by the user.
  render_output_id uuid not null references public.render_outputs (id) on delete cascade,
  storyboard_id uuid not null references public.storyboards (id) on delete cascade,
  project_id uuid not null references public.content_projects (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'reels', 'shorts')),
  -- 'manual' only for now; platform adapters add 'api' when they exist.
  method text not null default 'manual' check (method in ('manual')),
  -- draft = export pack prepared, not posted · scheduled = user plans to post at scheduled_for
  -- published = user posted it and gave the URL · withdrawn = post taken down (kept for history)
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'withdrawn')),
  caption text not null check (char_length(caption) between 1 and 5000),
  disclosure text not null,
  affiliate_url text check (affiliate_url ~ '^https?://' and char_length(affiliate_url) <= 2000),
  scheduled_for timestamptz,
  published_at timestamptz,
  external_url text check (external_url ~ '^https://' and char_length(external_url) <= 2000),
  external_id text check (char_length(external_id) <= 200),
  notes text check (char_length(notes) <= 1000),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The affiliate disclosure must stay in the caption (PLAN.md M3: disclosure is required).
  check (position(disclosure in caption) > 0),
  check (status <> 'scheduled' or scheduled_for is not null),
  check (status not in ('published', 'withdrawn') or (published_at is not null and external_url is not null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);

create index publications_owner_updated_idx on public.publications (owner_id, updated_at desc);
create index publications_output_idx on public.publications (render_output_id);
-- No double posting: one live publication per content project and platform. Withdrawn rows
-- don't count, so a corrected video can be posted again after the old post is taken down.
create unique index publications_one_per_project_platform on public.publications (project_id, platform) where status <> 'withdrawn';
-- The same post can't be recorded twice.
create unique index publications_external_url_unique on public.publications (owner_id, external_url) where external_url is not null;

create trigger publications_updated_at before update on public.publications
  for each row execute function public.set_updated_at();

-- Derives storyboard/project/disclosure from the rendered file and enforces the status flow.
-- Runs as the caller, so the lookup only sees the caller's own outputs (RLS).
create or replace function public.prepare_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src record;
begin
  if tg_op = 'UPDATE' and old.status in ('published', 'withdrawn') then
    if new.render_output_id is distinct from old.render_output_id
       or new.platform is distinct from old.platform
       or new.caption is distinct from old.caption
       or new.published_at is distinct from old.published_at
       or new.external_url is distinct from old.external_url then
      raise exception 'publication is already published; only notes, post ID and withdrawal can change' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status in ('draft', 'scheduled') and new.status in ('draft', 'scheduled', 'published'))
      or (old.status = 'published' and new.status = 'withdrawn')
    ) then
      raise exception 'invalid publication status change % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' and new.status not in ('draft', 'scheduled') then
    raise exception 'a publication starts as draft or scheduled' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' or new.render_output_id is distinct from old.render_output_id then
    select s.id as storyboard_id, s.project_id, s.disclosure, s.status, o.report
      into src
      from public.render_outputs o
      join public.render_jobs j on j.id = o.job_id
      join public.storyboards s on s.id = j.storyboard_id
     where o.id = new.render_output_id and o.owner_id = new.owner_id;
    if not found then
      raise exception 'render output not found' using errcode = '42501';
    end if;
    if src.status <> 'approved' then
      raise exception 'only videos of approved scripts can be published' using errcode = 'P0001';
    end if;
    if coalesce((src.report ->> 'ok')::boolean, true) = false then
      raise exception 'video did not pass QA' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and src.project_id <> old.project_id then
      raise exception 'a publication can only switch to another render of the same content' using errcode = 'P0001';
    end if;
    new.storyboard_id := src.storyboard_id;
    new.project_id := src.project_id;
    new.disclosure := src.disclosure;
  elsif tg_op = 'UPDATE' then
    new.storyboard_id := old.storyboard_id;
    new.project_id := old.project_id;
    new.disclosure := old.disclosure;
  end if;

  new.withdrawn_at := case when new.status = 'withdrawn' then coalesce(new.withdrawn_at, now()) else null end;
  return new;
end;
$$;

create trigger publications_prepare before insert or update on public.publications
  for each row execute function public.prepare_publication();

alter table public.publications enable row level security;

create policy "publications: owner selects" on public.publications
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "publications: owner inserts" on public.publications
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "publications: owner updates" on public.publications
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Posted records stay as history (withdraw instead); only unposted ones can be deleted.
create policy "publications: owner deletes unposted" on public.publications
  for delete to authenticated using (owner_id = (select auth.uid()) and status in ('draft', 'scheduled'));

revoke all on public.publications from anon;
grant select, insert, delete on public.publications to authenticated;
-- Derived columns (storyboard, project, disclosure, withdrawn_at) are set by the trigger only.
revoke update on public.publications from authenticated;
grant update (render_output_id, platform, status, caption, affiliate_url, scheduled_for, published_at, external_url, external_id, notes) on public.publications to authenticated;
