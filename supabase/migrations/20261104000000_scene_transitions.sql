-- AI-4 follow-up: how each scene enters from the previous one. 'auto' = the template default
-- (a short crossfade); editable after approval, like the rest of the visual plan.
alter table public.scene_visual_plans
  add column transition text not null default 'auto' check (transition in ('auto', 'cut', 'fade', 'slide', 'zoom'));
