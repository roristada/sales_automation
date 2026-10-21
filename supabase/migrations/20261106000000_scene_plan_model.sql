-- Video Studio: pick the video model per scene, next to its prompt. NULL = the model set for
-- the scene's task in Settings (ai_settings.models).
alter table public.scene_visual_plans
  add column model text check (model ~* '^[a-z0-9][\w.-]*/[\w.:~-]+$' and char_length(model) <= 200);
