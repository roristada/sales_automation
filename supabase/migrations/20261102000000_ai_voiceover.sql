-- AI-5 (docs/AI_VIDEO_PLAN.md): Thai voice-over via OpenRouter TTS, and background music from
-- the asset library.

-- ---------------------------------------------------------------------------
-- Voice setting (the TTS model itself is a pick in ai_settings.models under "tts")
-- ---------------------------------------------------------------------------

-- NULL = the model's default voice (code). Voice ids are short names/ids like "Kore".
alter table public.ai_settings
  add column tts_voice text check (tts_voice ~ '^[A-Za-z0-9_.:-]{1,100}$');

-- ---------------------------------------------------------------------------
-- Speech cache: the same text with the same model, voice and delivery is generated once.
-- ---------------------------------------------------------------------------

create table public.tts_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- sha256 of model, voice, instructions and text (src/features/ai/voiceover.ts).
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  model text not null check (char_length(model) between 1 and 200),
  voice text check (char_length(voice) <= 100),
  text_chars integer not null check (text_chars > 0),
  storage_key text not null check (char_length(storage_key) <= 500),
  mime text not null check (mime in ('audio/mpeg')),
  duration_s real not null check (duration_s > 0),
  created_at timestamptz not null default now(),
  unique (owner_id, cache_key)
);

alter table public.tts_cache enable row level security;

-- Written by the render worker (service role) only; the owner can see what's cached.
create policy "tts cache: owner selects" on public.tts_cache
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.tts_cache from anon, authenticated;
grant select on public.tts_cache to authenticated;

-- ---------------------------------------------------------------------------
-- Music: audio files in the asset library
-- ---------------------------------------------------------------------------

alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'video', 'audio'));

-- A scene shows an image or a clip; music is chosen per render instead.
create or replace function public.scene_asset_is_visual() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.asset_id is not null and exists (select 1 from public.assets a where a.id = new.asset_id and a.kind = 'audio') then
    raise exception 'ไฟล์เสียงใช้เป็นภาพของฉากไม่ได้' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger storyboard_scenes_visual_asset before insert or update of asset_id on public.storyboard_scenes
  for each row execute function public.scene_asset_is_visual();
