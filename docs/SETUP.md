# Local setup

## Requirements

- Node.js 22+, npm 10+
- Docker Desktop (running) — for local Supabase
- FFmpeg (ffprobe is used for render QA) — `winget install Gyan.FFmpeg`, then open a new terminal; or set `FFPROBE_PATH`

## First run

```bash
npm install
npm run db:start        # starts local Supabase (first run pulls Docker images) and applies migrations
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
# from the output of `npx supabase status` (API URL = http://127.0.0.1:55321)
npm run dev             # http://localhost:3000
```

Local Supabase has email confirmation **off**, so "สร้างบัญชี" signs you in immediately.
Studio (DB browser): http://127.0.0.1:55323 · Mailpit (auth emails): http://127.0.0.1:55324

Ports are in the 553xx range so this project can run beside other local Supabase projects.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Unit tests (Vitest, no DB needed) |
| `npm run test:rls` | RLS isolation tests — creates and deletes users in **local** Supabase only |
| `npm run test:e2e` | Playwright acceptance flow (needs `npm run build` and local Supabase first) |
| `npm run db:reset` | Re-create local DB from migrations |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` after a migration |
| `npm run worker` | Render worker — keep it running in its own terminal to turn queued renders into MP4s |
| `npm run worker -- --drain` | Render everything in the queue, then exit |
| `npm run remotion:studio` | Remotion Studio for working on the video template (`src/remotion/`) |
| `npm run backup` | Back up the local DB + stored files to `backups/<time>/`, test-restored before it reports success (`-- --keep 7` prunes) |
| `npm run restore -- backups/<time>` | Restore a backup into a DB with no accounts yet — see docs/DEPLOY.md |

First e2e run: `npx playwright install chromium`.

## Adding a migration

```bash
npx supabase migration new <name>   # edit the generated SQL
npx supabase migration up && npm run db:types   # applies new migrations, keeps your data
npx supabase db diff                            # optional: checks all migrations on a fresh shadow DB
npm run test:rls
```

Every new user-owned table needs `owner_id uuid not null default auth.uid()`, RLS enabled,
owner-only policies, explicit grants, and a case in `tests/rls/isolation.test.ts`.

`npm run db:reset` also works but **deletes all local data** (users, products, scripts).

## Rendering videos (Milestone 4)

1. Approve a script in Script Studio → "ไปทำวิดีโอ" → **Render วิดีโอ** (the job is queued in Postgres).
2. In a second terminal: `npm run worker`. The first run downloads Chrome Headless Shell (~120 MB) for Remotion.
3. Outputs (MP4, thumbnail, SRT, VTT) are stored under `storage/renders/<user>/<job>/` (`RENDER_STORAGE_DIR` to change) and served only to their owner.

Assets uploaded in คลังไฟล์ are stored the same way under `storage/renders/<user>/<asset>/`.
Each render is logged in `usage_events`; set `RENDER_COST_THB_PER_VIDEO_SECOND` (web app and worker) if rendering ever costs money — spending caps in Settings only stop paid work.

Without a TTS provider videos are silent (with a silent AAC track) and timed from a Thai speech estimate.
Remotion runs under its Free License (individual use) — see docs/LICENSING.md; set `REMOTION_LICENSE_KEY` if that changes.

## Production, monitoring, backup

See [DEPLOY.md](DEPLOY.md) (running in production, Settings → สถานะระบบ, `/api/health`, backup/restore) and [SECURITY.md](SECURITY.md).

## Cloud Supabase (when deploying)

1. Create a project at supabase.com (free plan is enough for MVP).
2. `npx supabase link --project-ref <ref>` then `npx supabase db push` to apply migrations.
3. Auth → URL Configuration: set Site URL and add `<site>/auth/callback` to Redirect URLs.
4. Put the project URL and anon key in the deployment's env vars. Never expose the service-role key to the app.
5. Run the RLS tests' scenarios manually or against a staging project before going live — the automated suite refuses non-local URLs on purpose.
