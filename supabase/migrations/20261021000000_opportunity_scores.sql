-- Milestone 2: explainable Opportunity Score per product.
-- The score is computed in TypeScript (src/features/research/opportunity-score.ts) whenever a
-- product is written, and stored here so lists can sort/filter by it. Detail pages recompute it
-- live from the product, so `result` is an audit snapshot, not the source of truth.

create table public.opportunity_scores (
  product_id uuid primary key references public.products (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 0–100, or NULL when there is not enough real data (no commission data at all).
  score smallint check (score between 0 and 100),
  -- Time-independent confidence; staleness is applied at read time.
  confidence text check (confidence in ('high', 'medium', 'low')),
  check ((score is null) = (confidence is null)),
  -- Bumped when the scoring formula changes, so old rows can be found and recomputed.
  score_version smallint not null,
  -- Full explanation: components, evidence, missing data, limitations and the inputs used.
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  computed_at timestamptz not null default now()
);

create index opportunity_scores_owner_score_idx on public.opportunity_scores (owner_id, score desc nulls last);

alter table public.opportunity_scores enable row level security;

create policy "scores: owner selects" on public.opportunity_scores
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "scores: owner inserts" on public.opportunity_scores
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "scores: owner updates" on public.opportunity_scores
  for update to authenticated using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "scores: owner deletes" on public.opportunity_scores
  for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.opportunity_scores from anon;
grant select, insert, update, delete on public.opportunity_scores to authenticated;

-- Products joined with their stored score, for the research list (sort by score).
-- security_invoker: the caller's RLS on products/opportunity_scores applies.
create view public.research_products
with (security_invoker = true) as
select
  p.*,
  s.score as opportunity_score,
  s.confidence as opportunity_confidence,
  s.score_version
from public.products p
left join public.opportunity_scores s on s.product_id = p.id;

revoke all on public.research_products from anon;
grant select on public.research_products to authenticated;
