-- AI-6 (docs/AI_VIDEO_PLAN.md): several products at once, reusing approved AI clips, and the
-- real cost of each video (AI calls + render) in Analytics.

-- ---------------------------------------------------------------------------
-- Batches: one row per "สร้างหลายวิดีโอ", one item per product
-- ---------------------------------------------------------------------------

create table public.content_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id text not null check (char_length(template_id) between 1 and 100),
  platform text not null check (platform in ('tiktok', 'reels', 'shorts')),
  target_duration_s integer not null check (target_duration_s between 5 and 180),
  -- Write each script with AI after drafting it from the template.
  use_ai boolean not null default false,
  -- AI spend for the whole batch; NULL = only the usual caps.
  budget_thb numeric(12, 2) check (budget_thb >= 0),
  created_at timestamptz not null default now()
);

create index content_batches_owner_idx on public.content_batches (owner_id, created_at desc);

create table public.content_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.content_batches (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  position integer not null check (position >= 0),
  -- pending → drafted (project + template script) → written (AI script applied); failed keeps
  -- the error and can be run again. working = claimed by a run (stale after a few minutes).
  status text not null default 'pending' check (status in ('pending', 'working', 'drafted', 'written', 'failed')),
  project_id uuid references public.content_projects (id) on delete set null,
  storyboard_id uuid references public.storyboards (id) on delete set null,
  error text check (char_length(error) <= 1000),
  cost_thb numeric(12, 4) not null default 0 check (cost_thb >= 0),
  updated_at timestamptz not null default now(),
  unique (batch_id, product_id),
  unique (batch_id, position)
);

create index content_batch_items_batch_idx on public.content_batch_items (batch_id, position);

create trigger content_batch_items_updated_at before update on public.content_batch_items
  for each row execute function public.set_updated_at();

alter table public.content_batches enable row level security;
alter table public.content_batch_items enable row level security;

create policy "batches: owner selects" on public.content_batches
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "batches: owner inserts" on public.content_batches
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "batches: owner deletes" on public.content_batches
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "batch items: owner selects" on public.content_batch_items
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "batch items: owner inserts" on public.content_batch_items
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and status = 'pending'
    and exists (select 1 from public.content_batches b where b.id = batch_id and b.owner_id = (select auth.uid()))
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "batch items: owner updates" on public.content_batch_items
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.content_projects p where p.id = project_id and p.owner_id = (select auth.uid()) and p.product_id = content_batch_items.product_id))
    and (storyboard_id is null or exists (select 1 from public.storyboards s where s.id = storyboard_id and s.owner_id = (select auth.uid()) and s.project_id = content_batch_items.project_id))
  );

-- Supabase grants every privilege on new tables to anon/authenticated by default.
revoke all on public.content_batches, public.content_batch_items from anon, authenticated;
grant select, insert, delete on public.content_batches to authenticated;
grant select on public.content_batch_items to authenticated;
grant insert (batch_id, product_id, position) on public.content_batch_items to authenticated;
grant update (status, project_id, storyboard_id, error, cost_thb) on public.content_batch_items to authenticated;

-- ---------------------------------------------------------------------------
-- Reuse an approved AI clip in another scene of the same product (no new generation, no cost)
-- ---------------------------------------------------------------------------

create or replace function public.reuse_scene_clip(target_scene uuid, source uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.scene_generations;
  tgt_storyboard uuid;
  created uuid;
begin
  select g.* into src from public.scene_generations g
   where g.id = source and g.owner_id = auth.uid() and g.review_status = 'approved' and g.status = 'succeeded' and g.asset_id is not null;
  if src.id is null then
    raise exception 'ไม่พบคลิปที่อนุมัติแล้วนี้' using errcode = 'P0002';
  end if;
  -- Target: the caller's scene, in an approved storyboard of the same product, planned as an AI clip.
  select s.storyboard_id into tgt_storyboard
    from public.storyboard_scenes s
    join public.storyboards b on b.id = s.storyboard_id
    join public.content_projects p on p.id = b.project_id
    join public.scene_visual_plans v on v.scene_id = s.id and v.mode = 'ai_video'
   where s.id = target_scene and b.owner_id = auth.uid() and b.status = 'approved'
     and p.product_id = (select p2.product_id from public.storyboards b2 join public.content_projects p2 on p2.id = b2.project_id where b2.id = src.storyboard_id);
  if tgt_storyboard is null then
    raise exception 'ใช้คลิปนี้กับฉากนี้ไม่ได้ (ต้องเป็นสินค้าเดียวกัน สคริปต์อนุมัติแล้ว และฉากตั้งเป็นคลิป AI)' using errcode = '42501';
  end if;
  if exists (select 1 from public.scene_generations g where g.scene_id = target_scene and g.status in ('queued', 'generating')) then
    raise exception 'ฉากนี้มีคลิปที่กำลังสร้างอยู่ — รอให้เสร็จหรือยกเลิกก่อน' using errcode = '55000';
  end if;
  -- The reused clip becomes this scene's approved clip.
  update public.scene_generations set review_status = 'pending' where scene_id = target_scene and review_status = 'approved';
  insert into public.scene_generations (owner_id, scene_id, storyboard_id, video_task, model, prompt, duration_s, resolution, first_frame_url, est_cost_thb, status, review_status, review_note, cost_usd, cost_thb, asset_id, finished_at)
  values (src.owner_id, target_scene, tgt_storyboard, src.video_task, src.model, src.prompt, src.duration_s, src.resolution, src.first_frame_url, 0, 'succeeded', 'approved', 'ใช้ซ้ำจากคลิปที่อนุมัติแล้ว', 0, 0, src.asset_id, now())
  returning id into created;
  return created;
end;
$$;

revoke all on function public.reuse_scene_clip(uuid, uuid) from public, anon;
grant execute on function public.reuse_scene_clip(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cost per content project: renders + every AI call tied to its storyboards
-- ---------------------------------------------------------------------------

drop function public.project_costs();
create function public.project_costs()
returns table (project_id uuid, cost_thb numeric, renders bigint, ai_thb numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select s.project_id, coalesce(sum(u.est_cost_thb), 0) as thb, count(distinct j.id) as n
      from public.usage_events u
      join public.render_jobs j on j.id = u.render_job_id
      join public.storyboards s on s.id = j.storyboard_id
     where u.owner_id = (select auth.uid())
     group by s.project_id
  ), a as (
    select s.project_id, coalesce(sum(q.cost_thb), 0) as thb
      from public.ai_requests q
      join public.storyboards s on s.id = q.storyboard_id
     where q.owner_id = (select auth.uid())
     group by s.project_id
  )
  select coalesce(r.project_id, a.project_id), coalesce(r.thb, 0) + coalesce(a.thb, 0), coalesce(r.n, 0), coalesce(a.thb, 0)
    from r full join a on a.project_id = r.project_id;
$$;

revoke all on function public.project_costs() from public, anon;
grant execute on function public.project_costs() to authenticated;
