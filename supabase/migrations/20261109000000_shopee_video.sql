-- Shopee Video as a fourth platform: affiliates tag the product on the clip, so viewers buy
-- from the video itself (no follower minimum, unlike the TikTok Shop basket).
alter table public.content_projects drop constraint content_projects_platform_check,
  add constraint content_projects_platform_check check (platform in ('tiktok', 'reels', 'shorts', 'shopee_video'));
alter table public.publications drop constraint publications_platform_check,
  add constraint publications_platform_check check (platform in ('tiktok', 'reels', 'shorts', 'shopee_video'));
alter table public.content_batches drop constraint content_batches_platform_check,
  add constraint content_batches_platform_check check (platform in ('tiktok', 'reels', 'shorts', 'shopee_video'));
