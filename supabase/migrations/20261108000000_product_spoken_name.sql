-- The product's name as said in a clip (shop titles are long keyword lists). NULL = a short
-- name derived from the title (src/features/content/templates.ts spokenName).
alter table public.products add column spoken_name text check (char_length(spoken_name) between 1 and 60);
