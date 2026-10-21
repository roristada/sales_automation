-- AI-5: music files in the asset library.
-- Same guard as 20261025000000_asset_key_guard.sql, with the audio types added.
alter table public.assets drop constraint assets_storage_key_own, drop constraint assets_mime_accepted;
alter table public.assets
  add constraint assets_storage_key_own check (
    storage_key = owner_id::text || '/' || id::text || '/' || substring(storage_key from '[^/]+$')
    and storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/original\.(jpg|png|webp|mp4|mov|webm|mp3|m4a|wav)$'
  ),
  add constraint assets_mime_accepted check (
    mime in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav')
  ),
  add constraint assets_kind_matches_mime check (split_part(mime, '/', 1) = case kind when 'audio' then 'audio' when 'image' then 'image' else 'video' end);
