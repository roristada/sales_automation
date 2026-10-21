-- AI-3 (docs/AI_VIDEO_PLAN.md): AI video clips per scene of an approved storyboard. A scene's
-- visual plan (motion graphics or an AI clip, and the prompt) is kept beside the locked script;
-- each generation attempt is a row the worker processes through OpenRouter, and the user reviews
-- the result before it can be used.

-- ---------------------------------------------------------------------------
-- Visual plan per scene (editable after approval: it doesn't change what the script says)
-- ---------------------------------------------------------------------------

create table public.scene_visual_plans (
  scene_id uuid primary key references public.storyboard_scenes (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storyboard_id uuid not null references public.storyboards (id) on delete cascade,
  -- product_motion = motion graphics from the product photo (free, no AI clip)
  mode text not null default 'product_motion' check (mode in ('product_motion', 'ai_video')),
  -- Which model setting to use: the product itself moving (photo as first frame) or a lifestyle shot.
  video_task text not null default 'video_product' check (video_task in ('video_product', 'video_lifestyle')),
  prompt text not null default '' check (char_length(prompt) <= 2000),
  duration_s integer not null default 5 check (duration_s between 1 and 20),
  updated_at timestamptz not null default now()
);

create index scene_visual_plans_storyboard_idx on public.scene_visual_plans (storyboard_id);

create trigger scene_visual_plans_updated_at before update on public.scene_visual_plans
  for each row execute function public.set_updated_at();

alter table public.scene_visual_plans enable row level security;

create policy "visual plans: owner selects" on public.scene_visual_plans
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "visual plans: owner inserts" on public.scene_visual_plans
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboard_scenes s where s.id = scene_id and s.storyboard_id = scene_visual_plans.storyboard_id and s.owner_id = (select auth.uid()))
  );
create policy "visual plans: owner updates" on public.scene_visual_plans
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.storyboard_scenes s where s.id = scene_id and s.storyboard_id = scene_visual_plans.storyboard_id and s.owner_id = (select auth.uid()))
  );
create policy "visual plans: owner deletes" on public.scene_visual_plans
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Supabase grants every privilege on new tables to anon/authenticated by default.
revoke all on public.scene_visual_plans from anon, authenticated;
-- Upserts set every column, so update covers them all; the policy keeps scene and storyboard consistent.
grant select, insert, update, delete on public.scene_visual_plans to authenticated;

-- ---------------------------------------------------------------------------
-- Generation attempts
-- ---------------------------------------------------------------------------

create table public.scene_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scene_id uuid not null references public.storyboard_scenes (id) on delete cascade,
  storyboard_id uuid not null references public.storyboards (id) on delete cascade,
  provider text not null default 'openrouter' check (provider = 'openrouter'),
  video_task text not null check (video_task in ('video_product', 'video_lifestyle')),
  model text not null check (char_length(model) between 1 and 200),
  -- Exactly what was sent.
  prompt text not null check (char_length(prompt) between 1 and 2000),
  duration_s integer not null check (duration_s between 1 and 20),
  aspect_ratio text not null default '9:16' check (aspect_ratio = '9:16'),
  resolution text not null default '720p' check (resolution in ('480p', '720p', '768p', '1080p')),
  first_frame_url text check (first_frame_url ~* '^https?://[^\s]+$' and char_length(first_frame_url) <= 2000),
  est_cost_thb numeric(12, 4) not null check (est_cost_thb >= 0),
  status text not null default 'queued' check (status in ('queued', 'generating', 'succeeded', 'failed', 'canceled')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  review_note text check (char_length(review_note) <= 500),
  -- Worker-written.
  openrouter_job_id text check (char_length(openrouter_job_id) <= 200),
  cost_usd numeric(12, 6),
  cost_thb numeric(12, 4),
  asset_id uuid references public.assets (id) on delete set null,
  error text check (char_length(error) <= 1000),
  locked_by text,
  locked_at timestamptz,
  polled_at timestamptz,
  submitted_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only a finished clip can be approved.
  check (review_status <> 'approved' or (status = 'succeeded' and asset_id is not null))
);

create index scene_generations_scene_idx on public.scene_generations (scene_id, created_at desc);
create index scene_generations_queue_idx on public.scene_generations (created_at) where status in ('queued', 'generating');
-- One attempt in flight per scene; one approved clip per scene.
create unique index scene_generations_one_active on public.scene_generations (scene_id) where status in ('queued', 'generating');
create unique index scene_generations_one_approved on public.scene_generations (scene_id) where review_status = 'approved';

create trigger scene_generations_updated_at before update on public.scene_generations
  for each row execute function public.set_updated_at();

alter table public.scene_generations enable row level security;

create policy "generations: owner selects" on public.scene_generations
  for select to authenticated using (owner_id = (select auth.uid()));
-- Queued by the owner for a scene of their own approved storyboard.
create policy "generations: owner queues" on public.scene_generations
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and status = 'queued'
    and review_status = 'pending'
    and exists (
      select 1 from public.storyboard_scenes s join public.storyboards b on b.id = s.storyboard_id
       where s.id = scene_id and b.id = scene_generations.storyboard_id and b.owner_id = (select auth.uid()) and b.status = 'approved'
    )
  );
create policy "generations: owner reviews" on public.scene_generations
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.scene_generations from anon, authenticated;
grant select on public.scene_generations to authenticated;
grant insert (scene_id, storyboard_id, video_task, model, prompt, duration_s, resolution, first_frame_url, est_cost_thb) on public.scene_generations to authenticated;
-- The owner reviews results; status, costs and the asset are the worker's.
grant update (review_status, review_note) on public.scene_generations to authenticated;

-- Owner cancels a job that hasn't finished (the worker stops polling; an OpenRouter job already
-- submitted may still be billed — the worker logs the cost if OpenRouter reports one).
-- Definer: the owner's column grant doesn't include status.
create or replace function public.cancel_scene_generation(generation uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with c as (
    update public.scene_generations set status = 'canceled', finished_at = now()
     where id = generation and owner_id = auth.uid() and status in ('queued', 'generating')
    returning 1
  )
  select exists (select 1 from c);
$$;
revoke all on function public.cancel_scene_generation(uuid) from public, anon;
grant execute on function public.cancel_scene_generation(uuid) to authenticated;

-- Worker: claim queued jobs (submit) or generating jobs due for a poll.
create or replace function public.claim_scene_generation(worker text, poll_every interval default interval '15 seconds', stale_after interval default interval '10 minutes')
returns setof public.scene_generations
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.scene_generations g
     set locked_by = worker, locked_at = now()
   where g.id = (
     select q.id from public.scene_generations q
      where (q.locked_by is null or q.locked_at < now() - stale_after)
        and (q.status = 'queued' or (q.status = 'generating' and (q.polled_at is null or q.polled_at < now() - poll_every)))
      order by q.status = 'generating' desc, q.created_at
      for update skip locked
      limit 1
   )
  returning g.*;
end;
$$;

revoke all on function public.claim_scene_generation(text, interval, interval) from public, anon, authenticated;
grant execute on function public.claim_scene_generation(text, interval, interval) to service_role;
