-- Video workspace: AI settings for one video (all its script versions), over the Settings
-- defaults: { "models": { "<task>": "<model id>" }, "tts_voice": "<voice>" }. Empty = defaults.
alter table public.content_projects
  add column ai_overrides jsonb not null default '{}' check (jsonb_typeof(ai_overrides) = 'object' and pg_column_size(ai_overrides) <= 4000);
