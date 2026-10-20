-- Milestone 2: data freshness per source, for /research/sources.
-- "As of" is retrieved_at, falling back to updated_at (same rule as fieldStatus / the freshness
-- filter). 14 days must match STALE_AFTER_DAYS in src/features/products/schema.ts.

create view public.product_freshness
with (security_invoker = true) as
select
  p.source,
  count(*)::int as total,
  count(*) filter (where coalesce(p.retrieved_at, p.updated_at) >= now() - interval '3 days')::int as fresh,
  count(*) filter (
    where coalesce(p.retrieved_at, p.updated_at) < now() - interval '3 days'
      and coalesce(p.retrieved_at, p.updated_at) >= now() - interval '14 days'
  )::int as aging,
  count(*) filter (where coalesce(p.retrieved_at, p.updated_at) < now() - interval '14 days')::int as stale,
  -- No retrieval date from the source: freshness falls back to the last edit.
  count(*) filter (where p.retrieved_at is null)::int as unknown_date,
  min(coalesce(p.retrieved_at, p.updated_at)) as oldest,
  max(coalesce(p.retrieved_at, p.updated_at)) as newest
from public.products p
group by p.source;

revoke all on public.product_freshness from anon;
grant select on public.product_freshness to authenticated;
