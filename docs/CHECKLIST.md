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

## Milestone 6 — Publishing ✅ manual (no platform API yet) (2026-10-20)
- [x] Migration `20261026000000_publishing.sql`: `publications` (render output, platform, method `manual`, status draft / scheduled / published / withdrawn, caption, affiliate URL, schedule, post URL/ID, notes); RLS owner-only
  - trigger derives storyboard, project and disclosure from the render output (user can't forge them); only approved, QA-passed videos; output must be the caller's own
  - caption must contain the storyboard's affiliate disclosure (SQL check)
  - "published" requires `published_at` + https post URL; a publication can't start as published
  - no double posting: one live publication per content project + platform (withdrawn ones don't count); the same post URL can't be recorded twice
  - posted rows lock caption/video/platform/URL; status flow draft ⇄ scheduled → published → withdrawn; posted rows can't be deleted (history); column grants keep derived columns read-only
- [x] `PublishingAdapter` interface + registry (TikTok, Instagram Reels, YouTube Shorts) — all "ยังไม่เชื่อมต่อ" with the real reason (OAuth + app review; YouTube unverified uploads are private); `publish` absent until access exists
- [x] Pure rules (`src/features/publishing/publishing.ts`): first caption = script caption + disclosure (+ link on Shorts, where description links work); post URL must be https on the platform's own hosts (no look-alikes); caption length per platform; warnings for no affiliate link / newer render
- [x] `/publishing`: platform status, "ready to publish" (rendered, not prepared), publications list (status, time, overdue schedule, post link)
- [x] `/publishing/[id]`: export pack (MP4, JPG, SRT, VTT named per platform), caption editor with copy + .txt download, affiliate link copy, where the link goes on the platform, pre-post checks, schedule (reminder only), "บันทึกว่าเผยแพร่แล้ว" with post URL, switch to the latest render, withdraw (confirm), delete unposted
- [x] Video Studio: "เผยแพร่" panel (existing publications + prepare; suggests a platform the content isn't on yet); Dashboard: "วิดีโอรอโพสต์" count; sidebar item enabled
- [x] Fix: worker passes a free port to Remotion — with another dev server on `0.0.0.0:3000` (e.g. remi_shop), Remotion's 127.0.0.1-only check passed and Chrome loaded the other app ("Jest worker encountered 2 child process exceptions")
- [x] Tests — unit 90 ✅ (publishing 6), RLS 15 ✅ (publications), e2e 8 specs ✅ (M6: prepare → export → disclosure kept → schedule → wrong-platform URL refused → published → same platform opens the same record → withdraw → prepare again → delete unposted); migrations verified on a fresh shadow DB

Not done in M6: posting through platform APIs (needs OAuth apps and platform approval per account) and post status read-back; those come as `PublishingAdapter.publish` + method `api`.

## Milestone 7 — Analytics ✅ from CSV exports (2026-10-20)
- [x] Migration `20261027000000_analytics.sql`: `publications.tracking_code` (per video, for Shopee Sub_id), `performance_imports`, `post_metrics` (cumulative totals per post per day, NULL = not in file), `affiliate_conversions` (order + item, status, commission, Sub_ids), `project_costs()`; RLS owner-only, rows must belong to the caller's own import of the right kind and (if matched) own publication
- [x] Post metrics CSV (`src/features/analytics/csv.ts`): header detection EN/TH (TikTok Studio, YouTube Studio incl. "Content" ID / Total row / watch hours, Instagram, hand-made), durations `83` / `0:09` / `1:02:03`, BE dates; no date column → file's day (Bangkok); bad rows skipped with line + reason
- [x] Matching (`post-key.ts`): post URL normalised per platform (TikTok `/video/<id>`, Shorts/youtu.be/watch?v, IG reel/p) or bare post ID; unmatched posts are stored but never counted for a video
- [x] Shopee Affiliate conversion report CSV: order id + net commission required (net wins over item commission), status → completed / pending / cancelled / unknown, zone-less times = Thai time, Sub_id1–5 read; **attributed only when a Sub_id equals the video's tracking code**
- [x] Re-import: same post + day replaces numbers; same order + item updates (pending → completed); delete an import removes its rows; "จับคู่ใหม่" and recording a post URL match rows imported earlier
- [x] `/analytics`: confirmed commission (all) vs from videos vs unattributed, pending, render cost; per-video table (latest views as of date, likes, comments, shares, avg watch, confirmed commission + pending, cost, net = confirmed − cost when the content has one post); imports list; nothing imported → "ไม่มีข้อมูล", never 0
- [x] Publication page: "การติดตามผล" with tracking code (copy) and its attributed results
- [x] Tests — unit 102 ✅ (analytics 12), RLS 16 ✅, e2e 9 specs ✅ (M7: metrics matched by URL, unmatched excluded, attributed vs unattributed vs pending, cost and net, re-import updates order, delete import)

Not done in M7: platform/Shopee APIs (no access) — numbers come only from files; view-to-sale attribution beyond the tracking code (not measurable from these exports).

## Milestone 8 — Production readiness ✅ (local; cloud deploy waits for a Supabase project) (2026-10-21)
- [x] Security review of M1–M7 (`docs/SECURITY.md`): security headers (`frame-ancestors 'none'`/XFO, nosniff, Referrer-Policy, Permissions-Policy, HSTS in production, no `X-Powered-By`); CSV export escapes formulas and import reads them back; DB-level `http(s)://` checks on every link rendered as href (migration `20261029000000_url_scheme_guard.sql`); `DISABLE_SIGNUP`; `postcss` override → `npm audit --omit=dev` 0
- [x] Monitoring: migration `20261028000000_monitoring.sql` — `worker_heartbeats` (service role only) + `worker_status()` (online/busy/last seen only); worker beats every 15 s, removes its row on clean stop
- [x] Settings → "สถานะระบบ": worker state + last beat, the user's queue (queued/processing/oldest), failed renders in 24 h (→ /videos), free disk on the storage drive (warn < 2 GB); Video Studio says "worker not running" from the heartbeat instead of guessing after 15 s
- [x] `GET /api/health` (public): 200 `{status, db, worker}` when the DB answers, 503 otherwise; `?worker=required` also fails when no worker is alive
- [x] `npm run backup`: `pg_dump` of public + `auth.users`/`auth.identities` and a copy of stored files, **test-restored into a scratch DB every time** (row counts in `manifest.json`), `--keep N`, `BACKUP_DIR`; `npm run restore`: only into a DB with no accounts and the same migration, single transaction, files copied without overwriting — verified end-to-end into a scratch database (all 26 tables' counts match, 170 files)
- [x] `docs/DEPLOY.md`: architecture limits (app + worker on one machine while storage is local disk), options A–D with cost, production run + autostart on Windows, Tailscale for phone access, pre-exposure checklist, moving to Supabase cloud, monitoring, backup/restore runbook
- [x] Tests — unit 105 ✅, RLS 18 ✅ (heartbeats, URL schemes), e2e 10 specs ✅ (M8: headers, health public + consistent with worker, heartbeat → online, Settings status)

Not done in M8: an actual cloud deployment (needs your Supabase project / host); object storage for files (needed before splitting app and worker across machines); off-machine copy of backups (choose a drive/cloud folder for `BACKUP_DIR`).

## AI-1 — OpenRouter foundation ✅ (docs/AI_VIDEO_PLAN.md) (2026-10-22)
- [x] `src/features/ai/openrouter.ts`: one client for OpenRouter (`OPENROUTER_API_KEY`, server/worker only) — `GET /key` (limit/remaining, free; the connection check), `GET /credits`, public catalogs `GET /models` + `GET /videos/models`, `POST /chat/completions` (JSON schema, reasoning effort, `usage.cost`); Thai error messages per status incl. errors inside a 200 body; timeout; retries only free GETs (a chat call may already be billed)
- [x] Models per task with defaults from the plan (`models.ts`): script/extract/scene prompts → `deepseek/deepseek-v4.1-flash`, clip review → `z-ai/glm-5.3-flash`, product motion → `kwaivgi/kling-v3.0-std`, lifestyle → `google/veo-3.1-fast`; dropdowns list only catalog models that fit (JSON schema; image input for extraction; video input for review; 9:16 + first frame for video); a pick missing from the catalog is flagged, not replaced
- [x] Migration `20261031000000_ai_foundation.sql`: `ai_settings` (models, per-video cap default ฿150, confirm threshold default ฿30), `ai_requests` (task, model, status, tokens, seconds, actual cost USD/THB, error, product/storyboard; owner insert/select only — never edited or deleted), `spend_summary()` now includes AI cost so the existing daily/monthly caps apply
- [x] `checkAiSpend`: daily/monthly caps + per-video cap + confirm-before-spend above the threshold (used from AI-2 on)
- [x] Settings → "AI (OpenRouter)": status from OpenRouter (key limit and remaining), "ทดสอบเรียก AI จริง" (one tiny call, logged with the cost OpenRouter reports), model per task, caps, recent calls; usage breakdown includes OpenRouter; `USD_THB_RATE` (default 35)
- [x] Tests — unit 127 ✅ (client contract with a stub fetch, pricing, picks, spend guard), RLS 19 ✅ (owner-only, log can't be forged/edited/deleted — privileges revoked, not just RLS — spend counts AI), e2e 13 specs ✅ (`ai1.spec.ts`: status, catalog dropdowns, save/reload, validation; doesn't press the paid button); a real call through the client: DeepSeek V4.1 Flash replied in Thai, $0.00005

## AI-2 — AI fills facts and writes scripts ✅ (docs/AI_VIDEO_PLAN.md) (2026-10-22)
- [x] `runAiChat` (`src/features/ai/run.ts`): model from Settings per task, spend guard first (daily/monthly + per-video cap from `ai_requests` of that storyboard + confirm threshold; estimate from catalog prices, mid-price fallback), every call logged with OpenRouter's real cost, truncated/empty replies refused
- [x] Facts: "ให้ AI ดึงเลย" in the extract dialog — description + up to 5 product photos (spec text printed on images), JSON schema `{facts:[{label,value,source}]}`; text facts still need every number to appear in the description, image facts are flagged "ดูรูปก่อนยืนยัน"; saved as AI estimate → existing confirm / confirm-all
- [x] Scene: "ให้ AI เขียนเลย" in AI ช่วยเขียน — same prompt as the copy button, reply goes through the same parser/preview (copy/paste still works)
- [x] Whole script: "ให้ AI เขียนทั้งสคริปต์" (Studio, beside approval) — hook, every scene in the existing structure, claims citing F-codes, CTA, caption as strict JSON (`ai-script.ts`); checked (scene count, lengths, unknown codes rejected, missing codes warned) → preview → `applyAiScript` (origin "ai", every claim pending, disclosure untouched); confirm-before-spend step when over the threshold
- [x] Script model bake-off: `scripts/ai-bakeoff.ts <storyboard>` → `storage/ai-bakeoff/*.md` (calls logged as spend). Run on the Edifier script: DeepSeek V4.1 Flash ฿0.017 and Claude Haiku 5.5 ฿0.063 both valid, natural Thai, claims mapped correctly; Qwen 3.8 Flash failed twice (provider rate limit / timeout); Sonnet 5.5 refused for low credit → default stays DeepSeek V4.1 Flash. Prompt tightened after it: no tying ad words ("เบสหนัก") to specs
- [x] Tests — unit 136 ✅ (script prompt/schema/parser, fact JSON + image source, fenced JSON), RLS 19 ✅, e2e 14 specs ✅ (`ai2.spec.ts`: buttons present; with `E2E_PAID=1` a real whole-script call → preview → apply → all scenes "AI", approve blocked, call + cost in Settings — ran once ✅)

Not done in AI-2: AI suggesting category / short description (facts only); Qwen and Sonnet in the bake-off (top up OpenRouter credit, then `npx tsx scripts/ai-bakeoff.ts <id> qwen/qwen3.8-flash anthropic/claude-sonnet-5.5`).

## AI-3 — AI clips per scene 🚧 code + tests done, real generation not yet run (needs OpenRouter credit) (docs/AI_VIDEO_PLAN.md) (2026-10-22)
- [x] Migration `20261101000000_ai_scene_clips.sql`: `scene_visual_plans` (mode motion graphics / AI clip, product-motion vs lifestyle, prompt, seconds — editable after approval since it doesn't change the script; policy keeps scene ↔ storyboard consistent), `scene_generations` (model, exact prompt, seconds, 9:16, resolution, first frame, estimate, status queued/generating/succeeded/failed/canceled, review pending/approved/rejected, OpenRouter job id, actual cost, asset; owner may only queue for an approved storyboard and set review fields — status/cost/asset are worker-only via column grants; one in flight and one approved per scene; approve only a finished clip), `cancel_scene_generation`, `claim_scene_generation` (worker only)
- [x] OpenRouter video client per docs (openrouter.ai/docs/guides/overview/multimodal/video-generation): `POST /videos` (never retried — a resubmit bills twice), `GET /videos/{id}` (status, `usage.cost`, error inside the payload), `GET /videos/{id}/content`; supported duration snapping, 720p preference, estimate from catalog prices (token-priced → cautious $0.15/s)
- [x] Worker (`worker/ai-clips.ts`, inside `npm run worker`): submit → poll every 15 s → download → ffprobe → asset (`ai_generated`, license "unknown" = check provider terms, attribution = model) → cost in `ai_requests`; gives up after 30 min; download errors retry
- [x] "ให้ AI วางแผนภาพทุกฉาก" (scene_prompt model, JSON): which scenes become AI clips + English prompts from confirmed facts only; rules: no invented features, no real people / celebrities, no on-screen text, keep the product as in the photo
- [x] Video Studio → "คลิป AI ต่อฉาก": per scene mode/type/prompt/seconds, model + estimate, generate / regenerate only that scene (spend guard incl. clips still in flight; confirm step), cancel, preview with "คลิป AI — สินค้าอาจไม่ตรงของจริง 100%", approve ("ใช้คลิปนี้") / reject; auto-refresh while generating
- [x] Tests — unit 143 ✅, RLS 24 ✅ (`tests/rls/ai-clips.test.ts`: permissions + the worker pipeline end to end against a **fake** OpenRouter server — submit body, single submit, polling, MP4 stored as asset, cost logged, failed submit not retried, cancel), e2e 15 specs ✅ (`ai3.spec.ts`: plan an AI clip, saved, model + estimate shown; nothing paid clicked)

Not done in AI-3: a real clip through OpenRouter (acceptance) and the 3-model comparison (Veo 3.1 Lite / Kling v3.0 std / Veo 3.1 Fast) — both wait for credit; render using approved clips is AI-4.
