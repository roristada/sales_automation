# Checklist

## Phase 0 — Planning ✅ (2026-10-20)
- [x] Repository audit
- [x] Architecture + folder structure
- [x] Database schema + migration plan
- [x] API availability / credentials / licensing check
- [x] Cost estimate + risks
- [x] Milestones + acceptance criteria

## Milestone 1 — Foundation ✅ (2026-10-20)
- [x] Next.js 15 + React 19 + TS strict + Tailwind 4 + shadcn/ui
- [x] Local Supabase config (ports 553xx)
- [x] Auth: sign up, login, logout, session refresh (middleware), protected routes, server-side user check
- [x] Profiles (auto-created) + display name edit
- [x] Migrations: profiles, products, product_price_history, import_batches, import_row_errors
- [x] RLS on every table + explicit grants
- [x] Product CRUD (shared Zod schema, field errors, values kept on error)
- [x] Duplicate detection (source product ID, normalised URL)
- [x] Per-field data status: verified / user-provided / CSV / AI estimate / unavailable / stale
- [x] Price + commission history (DB trigger)
- [x] CSV import: column mapping (auto-guess EN/TH), preview validation, skip/update duplicates, chunked (500 rows), failed rows stored and shown, summary
- [x] Dashboard: totals, missing data, stale data, by source, recent imports
- [x] Tests — unit 15 ✅, RLS 8 ✅ (real local Supabase), e2e 2 specs ✅ (Playwright, desktop + mobile)
- [x] lint ✅ typecheck ✅ build ✅

Not verified yet: cloud Supabase (no project yet), email-confirmation flow (local has it off).

## UI pass — design.md ✅ (2026-10-20)
- [x] Design tokens (§3) in globals.css, light default, dark-ready; deviations recorded in design.md §16
- [x] Controls 36–40px, inputs 40px, radius 8px, system font + Noto Sans Thai
- [x] App shell: 240px collapsible sidebar (remembered via cookie, tooltips when collapsed), mobile drawer, skip link, nav order §6, planned modules labelled "เร็วๆ นี้"
- [x] Shared components: PageHeader/breadcrumb, Notice, Empty/Error states, StatusBadge, TrustBadge, Field, NativeSelect, ConfirmDialog, CopyButton, DataTable
- [x] Product Research (/research) with source/category/freshness/missing filters + sort, stacked rows on mobile
- [x] Products catalogue, Product Detail (summary + tabs, copy affiliate URL, stale warning), grouped product form with collapsible advanced section
- [x] Dashboard as work queue (no decorative KPI cards), import result page, Settings groups with honest provider status (no secrets)
- [x] Delete via confirmation dialog (was window.confirm)
- [x] e2e: desktop flow + mobile (drawer nav, no horizontal scroll on 6 screens)
- [x] Content Planner / Script Studio UI (M3) · [x] Video Studio UI (M4)

## Milestone 2 — Product Research ✅ except Shopee API (2026-10-20)
- [x] ProductSourceAdapter interface + registry (csv, manual, shopee_affiliate, tiktok_shop) — `src/features/sources/`; API sources have no `fetchProducts` and report `not_available`; `fetchSourcePage` validates API output with the shared product schema; Settings reads Shopee/TikTok status from the registry
- [ ] Shopee Affiliate adapter — **blocked until Thai Open API access confirmed**
- [x] Source connection status page — `/research/sources`: each adapter's real state, product count, last CSV import
- [x] Data freshness view + bulk re-import
  - view `product_freshness` (security_invoker): per source ≤3 days / 4–14 / >14 / no retrieval date / oldest
  - export stale products as CSV (`/research/sources/export`, headers auto-map on import, BOM for Excel)
  - CSV import matches "System ID" first → re-import in update mode updates in place (manual products without URL too); unknown System ID → row error, never a new product
  - `/products/import?mode=update` preselects update mode
- [x] Opportunity Score v1 (2026-10-20) — `src/features/research/opportunity-score.ts`
  - components: commission per sale 40%, commission rate 20%, price fit for short video 20%, content readiness 20%
  - missing component → left out of the average, confidence drops; no commission data → no score ("ข้อมูลไม่พอ")
  - AI-estimate values cap confidence at medium; stale price/commission lowers confidence one level at read time
  - stored in `opportunity_scores` (RLS) on every product write; `research_products` view (security_invoker) for sort by score
  - /research: score column + sort; product page: "คะแนนโอกาส" tab with components, evidence, missing data, limitations
  - products without a score / old formula version → notice + "คำนวณคะแนน" button
- [x] Trend adapter + trend CSV import
  - `TrendSourceAdapter`: Google Trends CSV = available; Google Trends API = not_available (alpha, apply-only; no scraping)
  - migration `20261021000200_trends.sql`: `trend_imports`, `trend_observations` (keyword, region, period, value 0–100 + unit, `<1` kept as flag), `product_trend_links` (RLS on all)
  - parser for English/Thai UI exports (BE dates, BOM); any bad row rejects the file with reasons
  - each import is its own snapshot (Google values are relative per export); latest import per keyword is shown
  - trend direction: last N complete periods vs previous N (week 4, day 7, month 3), ±15% = flat; in-progress last period excluded
  - `/research/trends`: upload, keyword table with sparkline + direction, import list with delete
  - product page "สัญญาณเทรนด์" tab: link a keyword, line chart (crosshair tooltip, arrow keys, table view), stale warning; no link → "no data"
  - trend is **not** part of the Opportunity Score yet (stated in the score limitations and the tab)
- [x] Settings shows Google Trends API status from the trend adapter
- [x] Tests — unit 44 ✅, RLS 11 ✅, e2e 4 specs ✅ (incl. export → edit → re-import round trip, trends import/link/hover); mobile no-scroll check covers the new pages

## Milestone 3 — Content Planning ✅ (2026-10-20)
- [x] Migration `20261022000000_content_planning.sql`: `product_facts`, `content_projects`, `storyboards` (versioned, draft/approved, `approved_snapshot`), `storyboard_scenes`, `scene_claims` (cites a fact or a product field); RLS on all, children must belong to the caller's parents, claims may only cite the caller's facts
- [x] Approval lock in SQL: any change to an approved storyboard, its scenes or claims raises `P0001`; cascade deletes still work
- [x] Fact in use cannot be deleted alone (FK deferred to commit, so product delete still cascades)
- [x] Product facts: product page "ข้อเท็จจริง" tab (label, value, source link, trust label); built-in facts = name, price, category, marketplace, description; commission is never a fact
- [x] 6 Thai templates (`src/features/content/templates.ts`): รีวิวสั้น, ปัญหา → ทางแก้, 3 จุดเด่น, แกะกล่อง, แจ้งราคา, วิธีใช้
  - text only from facts; each factual sentence gets a claim citing its fact; missing facts → `[ ]` placeholders; no opinions/invented numbers; price scene says prices can change
  - feature scenes scale with duration (15s → 1, 30s → 2, 45/60s → 3); CTA per platform (TikTok / Reels / Shorts)
  - affiliate disclosure always included and not editable
- [x] Validator (`validate.ts`) — blocks approval on: missing disclosure, no hook/scenes, `[ ]` left, claim without fact, fact missing/unavailable/stale, claim not verified, rejected claim; warns on AI-estimate facts, numbers in text not backed by a cited fact, length vs target (Thai speech estimate)
- [x] Content Planner `/content` (list) + `/content/new` guided form (product → template with fact/price readiness → platform & length → draft)
- [x] Script Studio `/studio` (drafts / approved) + `/studio/[id]`: hook/caption/CTA, scenes (edit, reorder, add, delete, regenerate one scene from template), claims (edit, cite fact, verify/reject), issues shown next to each scene, approve (re-validated on the server), new version (claims stay verified only if their fact is unchanged), version switcher, unsaved-changes guard
- [x] `LlmProvider` interface; no provider configured → template-only, status shown in Studio and Settings
- [x] Tests — unit 62 ✅ (content 19), RLS 12 ✅ (incl. lock + cascade), e2e 5 specs ✅; migrations verified on a fresh shadow DB (`supabase db diff`)

- [x] Manual AI help (no API key; works with a Claude Pro/claude.ai subscription): "AI ช่วยเขียน" per scene → copy a prompt (facts numbered F1…, rules: no invented specs/numbers/superlatives, price may change, reply format) → paste the reply back → parsed (tolerates markdown, multi-line), previewed, applied as `text_origin = ai` with all claims `pending`; unknown F-codes rejected. Unit 67 ✅, e2e covers copy → paste → apply.

Not done in M3: AI via API (needs an Anthropic API account — separate from Claude Pro — plus model choice and budget cap); render is M4 (only approved storyboards will be renderable).

## Milestone 4 — Video Engine ✅ (silent; TTS pending) (2026-10-20)
- [x] Migration `20261023000000_video_engine.sql`: `render_jobs` (Postgres queue: status, progress, stage, attempt/max_attempts, error_code/message, lock), `render_outputs` (file keys, ffprobe facts, QA report)
  - insert policy only for **approved** storyboards (approve-before-render enforced in SQL)
  - one active job per storyboard (partial unique index) → double clicks don't queue twice
  - `claim_render_job` (FOR UPDATE SKIP LOCKED, stale-lock recovery) and `fail_exhausted_render_jobs` — service role only; `cancel_render_job` — owner only
- [x] Remotion 4.0.537 composition `src/remotion/AffiliateVideo.tsx`: 1080×1920@30, product image card (or name card), hook, on-screen text, word-wrapped Thai subtitles (Intl.Segmenter), end card with CTA + affiliate disclosure; platform UI safe areas; Noto Sans Thai
- [x] Timeline (`src/features/video/timeline.ts`): scene timing from Thai speech estimate (or measured audio later), contiguous subtitle cues, SRT/VTT export (disclosure included)
- [x] Worker `worker/render-worker.ts` (`npm run worker`, `--drain`): bundle once, product image → data URI (http(s), image/*, ≤5 MB, fallback card), H.264/AAC with silent track, thumbnail, SRT/VTT, ffprobe QA (size, fps, codecs, duration ±0.5 s, disclosure; image/voice as warnings), local disk storage adapter, progress + cancel, bounded retries (retryable vs not), readable Thai errors
- [x] `TtsProvider` interface; none configured → silent video, status shown in Video Studio and Settings
- [x] Video Studio `/videos` (approved scripts + latest render status) and `/videos/[id]`: live Remotion Player preview, render / rerender / cancel with live progress, "worker not running" hint, rendered video with VTT captions, downloads (MP4, JPG, SRT, VTT), QA report, render history
- [x] File route `/api/renders/[outputId]/[file]`: owner check via RLS, HTTP Range (206) for seeking, attachment downloads
- [x] FFmpeg 9.0.2 installed (winget); Remotion Free License confirmed (single user)
- [x] Tests — unit 75 ✅ (video 8), RLS 13 ✅ (render jobs), e2e 6 specs ✅ (M4 runs the real worker: render → QA → download with Range → rerender)

Not done in M4: Thai voice-over (TTS provider + `tts_cache`), `assets` table (M5 asset library). "Edit scene then rerender" works via a new storyboard version (approved scripts are locked).

## Milestone 5 — Workflow Automation ✅ (2026-10-20)
Queue, bounded retries, idempotency and approve-before-render were delivered in M4. Added here:
- [x] Migration `20261024000000_assets_usage.sql`: `assets` (kind, file facts set by the server, SHA-256 dedupe per user, source, license, attribution, AI flag, product), `storyboard_scenes.asset_id`, `usage_events` (worker-written), `spending_limits` (daily/monthly THB), `spend_summary()` (Asia/Bangkok day/month)
  - license defaults to `unknown`; users can edit descriptive columns only (column grants), never storage key/hash/size
  - an asset used in a scene can't be deleted (deferred FK, so account deletion still cascades)
- [x] Asset Library `/assets`: upload (streamed to disk, SHA-256, ffprobe dimensions/duration, JPG/PNG/WebP ≤20 MB, MP4/MOV/WebM ≤200 MB, real upload progress), grid with preview, source, license chip, AI flag, usage references, search/kind/"needs license review" filters, edit metadata, delete (blocked while used)
- [x] Licensing rules (`src/features/assets/licensing.ts`): non-commercial → blocks approval and render; unknown, CC BY without credit, product-page images without permission → warnings
- [x] Scenes can show a library image/clip full-screen (Script Studio picker; live preview; worker serves files to Remotion over loopback with per-job tokens; clips loop, muted)
- [x] Usage: every render logs video seconds + estimated cost; rate from `RENDER_COST_THB_PER_VIDEO_SECOND` (default 0 = local Free License)
- [x] Spending caps: Settings → "การใช้งานและค่าใช้จ่าย" (today/month spend, per-provider 30-day usage, daily/monthly caps); paid work over a cap is refused at queue time and re-checked by the worker, with a Thai message; free work is never blocked
- [x] Fix: file streaming no longer throws `Controller is already closed` when the browser cancels a video range request (custom cancel-safe stream)
- [x] Tests — unit 80 ✅, RLS 14 ✅, e2e 7 specs ✅ (M5: uploads, dedupe, license warnings/gate, assets in scenes, delete blocked while used, cap blocks render, render with clip+image, usage shown); run twice for stability

Not done: `tts_cache` (comes with a TTS provider).
