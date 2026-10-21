-- AI-3 follow-up: what the worker found about a finished clip's shape (not 9:16, black bars),
-- shown to the reviewer next to the clip. Worker-written; NULL = fills 9:16 cleanly.
alter table public.scene_generations add column quality_note text check (char_length(quality_note) <= 500);
