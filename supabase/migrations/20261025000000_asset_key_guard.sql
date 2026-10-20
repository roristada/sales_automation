-- Security fix: an asset row could be inserted through the API with a storage_key pointing at
-- another user's file, which /api/assets/[id] would then serve. The key must live under the
-- row's own owner and id, in the exact shape the upload route writes, with an accepted type.

alter table public.assets
  add constraint assets_storage_key_own check (
    storage_key = owner_id::text || '/' || id::text || '/' || substring(storage_key from '[^/]+$')
    and storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/original\.(jpg|png|webp|mp4|mov|webm)$'
  ),
  add constraint assets_mime_accepted check (
    mime in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')
  );
