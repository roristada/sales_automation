-- More product photos for the video template (scenes without library media cycle through them).
-- Stored as http(s) URLs, one per line, at most 9 besides image_url.

alter table public.products
  add column gallery_urls text
    check (
      gallery_urls ~* '^https?://[^\s]+(\nhttps?://[^\s]+){0,8}$'
      and char_length(gallery_urls) <= 18000
    );
