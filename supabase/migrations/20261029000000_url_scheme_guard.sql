-- Milestone 8 security review: links shown as <a href> must be http(s). The forms already check
-- this; the database now does too, so a row written straight through the API can't store a
-- javascript: or data: URL that runs when clicked.

alter table public.products
  add constraint products_product_url_scheme check (product_url ~* '^https?://'),
  add constraint products_affiliate_url_scheme check (affiliate_url ~* '^https?://'),
  add constraint products_image_url_scheme check (image_url ~* '^https?://');

alter table public.product_facts
  add constraint product_facts_source_url_scheme check (source_url ~* '^https?://');

alter table public.assets
  add constraint assets_source_url_scheme check (source_url ~* '^https?://');
