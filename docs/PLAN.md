# Phase 0 Plan — AI Affiliate Automation Platform

อัปเดต: 2026-10-20 · สถานะ: **Phase 0 เสร็จ, Milestone 1 เสร็จและทดสอบแล้ว, Milestone 2 เสร็จ ยกเว้น Shopee API (รอสิทธิ์), Milestone 3 เสร็จ, Milestone 4 เสร็จ (ยังไม่มีเสียงพากย์), Milestone 5 เสร็จ** (ดู [CHECKLIST.md](CHECKLIST.md))

---

## 1. Repository audit

| รายการ | ผล |
|---|---|
| `E:\Project_IS` | ไม่ใช่ git repo มีโปรเจกต์แยกกัน: `personal_trade` (Next 15 + Supabase), `mon` (Next 14 + Prisma), `remi_shop` |
| `sales_automation` | โปรเจกต์ใหม่ ไม่มีโค้ดเดิมที่ต้องรักษา |
| สิ่งที่นำมาใช้ซ้ำจาก `personal_trade` | Supabase SSR helpers (server/client/middleware), auth actions + login form, shadcn/ui components, Tailwind 4 theme, eslint/tsconfig — stack เดียวกันทำให้ดูแลง่าย |
| เครื่องมือในเครื่อง | Node 22.19, npm 10.9, Docker 29.5, Supabase CLI 2.121 (devDependency), git 2.54 |
| ยังขาด | **FFmpeg/ffprobe ไม่อยู่ใน PATH** (ต้องใช้ใน Milestone 4) |

## 2. Architecture

```
Browser ── Next.js App Router (src/app) ── Server Actions / Route Handlers
                │                                 │  (ตรวจ user ทุกครั้ง + RLS)
                │                                 ▼
                └──────────────► Supabase (Postgres + Auth + Storage)
                                                  ▲
           (M4) Render worker (Node, แยก process) ─┘  ← job queue ใน Postgres
                 ├─ TTS adapter (Google Cloud TTS, ต่อ Azure/Botnoi ได้)
                 ├─ Remotion (React composition) → MP4
                 └─ FFmpeg/ffprobe (probe, mix, encode, QA)
```

หลักการ:
- **Single Next.js app + worker แยก process** (worker จะอยู่ที่ `worker/` ใน M4) — ยังไม่ทำ monorepo จนกว่าจะจำเป็น
- **Feature folders** (`src/features/<feature>`) เก็บ schema / actions / UI ของแต่ละโดเมน
- **Adapter interfaces** สำหรับทุกบริการภายนอก: `ProductSourceAdapter`, `TrendSourceAdapter`, `TtsProvider`, `LlmProvider`, `StorageAdapter`, `PublishingAdapter` — business logic ไม่ผูกกับ vendor
- **Queue:** ใช้ Postgres (ตาราง jobs + `FOR UPDATE SKIP LOCKED` หรือ pg-boss) — ไม่ต้องเพิ่ม Redis
- **ห้าม mock ที่ดูเหมือนจริง:** integration ที่ไม่มี credentials แสดงสถานะ “ยังไม่ได้เชื่อมต่อ”

### Folder structure

```
sales_automation/
├─ src/
│  ├─ app/(auth)/         login, auth actions
│  ├─ app/(app)/          protected pages: dashboard, products, imports, settings
│  ├─ app/auth/callback/  email confirmation callback
│  ├─ features/products/  schema (Zod), csv mapping, server actions, UI
│  ├─ components/         ui (shadcn), layout, states
│  ├─ lib/supabase/       server/client/middleware + generated database.types.ts
│  └─ middleware.ts       session refresh + route protection
├─ supabase/migrations/   SQL migrations (source of truth ของ schema + RLS)
├─ tests/rls/             RLS isolation tests (local Supabase)
├─ tests/e2e/             Playwright acceptance tests
├─ worker/                (M4) render worker
└─ docs/                  PLAN, SETUP, LICENSING, CHECKLIST
```

## 3. Database schema และ migration plan

Migration ทั้งหมดอยู่ใน `supabase/migrations/` ทดสอบด้วย `supabase db reset` ทุกครั้ง ทุกตารางมี `owner_id` + RLS `owner_id = auth.uid()`

**M1 (ทำแล้ว — `20261020000000_foundation.sql`)**
- `profiles` — 1:1 กับ `auth.users`, สร้างอัตโนมัติด้วย trigger
- `products` — `source` (enum: manual/csv/shopee_affiliate/tiktok_shop), `source_product_id`, `marketplace`, ราคา/ค่าคอม (**NULL = ไม่มีข้อมูล ไม่ใช่ 0**), `provenance` jsonb (สถานะรายฟิลด์), `retrieved_at`, `url_key` (URL ที่ normalize แล้วสำหรับตรวจซ้ำ) + unique index `(owner, source, source_product_id)` และ `(owner, url_key)`
- `product_price_history` — trigger บันทึกเมื่อราคา/ค่าคอมเปลี่ยน
- `import_batches`, `import_row_errors` — สรุปการนำเข้าและแถวที่ผิด

**สถานะข้อมูล:** เก็บ `verified_source | user_provided | imported_csv | ai_estimate` ต่อฟิลด์ใน `provenance`; `unavailable` = ค่า NULL; `stale` = ราคา/ค่าคอมเก่ากว่า 14 วัน (คำนวณ ไม่เก็บ)

**M2 (ทำแล้วบางส่วน — `20261021000000_opportunity_scores.sql`)**
- `opportunity_scores` — 1:1 กับ product: `score` (0–100 หรือ NULL = ข้อมูลไม่พอ), `confidence`, `score_version`, `result` jsonb (องค์ประกอบ, หลักฐาน, ข้อมูลที่ขาด, ข้อจำกัด), `computed_at`; คำนวณใน TypeScript ทุกครั้งที่เขียนสินค้า
- view `research_products` (security_invoker) = products + คะแนน สำหรับเรียงตามคะแนน
- `20261021000100_product_freshness.sql` — view `product_freshness` สรุปความใหม่ต่อแหล่ง
- `20261021000200_trends.sql` — `trend_imports`, `trend_observations`, `product_trend_links`
- ยังไม่สร้าง `source_connections` / `source_sync_runs`: สถานะมาจาก adapter โดยตรง และยังไม่มี API source ที่ sync ได้ — สร้างพร้อม Shopee adapter

**M3 (ทำแล้ว — `20261022000000_content_planning.sql`)**
- `product_facts`, `content_projects`, `storyboards`, `storyboard_scenes`, `scene_claims` + trigger ล็อก storyboard ที่อนุมัติแล้ว

**M4 (ทำแล้ว — `20261023000000_video_engine.sql`)**
- `render_jobs` (คิวใน Postgres, render ได้เฉพาะสคริปต์ที่อนุมัติ, งาน active ได้ทีละงานต่อสคริปต์), `render_outputs`, ฟังก์ชัน `claim_render_job` / `cancel_render_job` / `fail_exhausted_render_jobs`
- ยังไม่สร้าง `tts_cache` — ตอนต่อ TTS

**M5 (ทำแล้ว — `20261024000000_assets_usage.sql`)**
- `assets` (สิทธิ์การใช้งาน, เครดิต, AI, SHA-256), `storyboard_scenes.asset_id`, `usage_events`, `spending_limits`, `spend_summary()`

**แผน migration ถัดไป**
| Milestone | ตาราง |
|---|---|
| M2 | `source_connections` (สถานะการเชื่อมต่อ adapter), `source_sync_runs`, `trend_observations` (keyword, category, region, time range, source, retrieved_at, value + หน่วยตามจริง) (`opportunity_scores` ทำแล้ว) |
| M3 | `content_projects`, `storyboards` (template_id, template_version, version, status draft/approved), `storyboard_scenes`, `scene_claims` (claim, fact_ref, review status) |
| M4 | `assets` (source, license, attribution, commercial_use, ai_generated, hash), `tts_cache` (cache_key = hash(provider+voice+config+text)), `render_jobs` (idempotency_key, status, attempt, error_code, progress), `render_outputs` (mp4, srt/vtt, thumbnail, report, probe data) |
| M5 | `usage_events` (provider, units, est_cost, job ref), `spending_limits` (daily/monthly) |
| M6–7 | `publications` (platform, url, status, posted_at — บันทึกเอง), `performance_imports`, `performance_metrics` |

## 4. API availability, credentials, permissions (ตรวจ 2026-10-20)

| บริการ | สถานะ | ข้อสรุป |
|---|---|---|
| **Supabase** | Local dev ใช้ได้ (Docker) | Cloud project ยังไม่ได้สร้าง — ต้องสร้างเองเมื่อจะ deploy (ดู SETUP.md) |
| **Google Cloud TTS** | ยังไม่มี credentials | ภาษาไทยมี: `th-TH-Standard-A` (หญิง), `th-TH-Neural2-C` (หญิง), **Chirp 3: HD 30 เสียง** (หญิง 14, ชาย 16) — ไม่มี WaveNet ภาษาไทย ต้องมี billing account แม้ใช้ free tier |
| **Shopee Affiliate Open API (TH)** | **ยังยืนยันไม่ได้** | มีหลักฐานว่ามี GraphQL Open API (`productOfferV2`) ในบางประเทศ (เช่น BR) แต่ไม่พบเอกสารของไทยที่เปิดสาธารณะ → ผู้ใช้ต้องตรวจในบัญชี affiliate.shopee.co.th ว่ามีเมนู Open API / AppID หรือไม่ ระหว่างนี้ใช้ CSV |
| **TikTok Shop Affiliate** | ยังไม่ตรวจสิทธิ์ | เตรียม enum + adapter interface เท่านั้น ไม่ implement |
| **Google Trends API** | Alpha, ต้องสมัครขอสิทธิ์ | ไม่มี self-serve API; ห้าม scrape → M2 ทำ adapter + สถานะ “unavailable” และรองรับ import CSV ที่ export จาก Trends UI ด้วยตนเอง |
| **Remotion** | ใช้ได้ | ดู licensing ด้านล่าง |

## 5. ค่าใช้จ่าย (เป้า 0–1,000 บาท/เดือน, ประมาณการ — ต้องตรวจราคาล่าสุดก่อนเปิดใช้)

| รายการ | ราคาที่ตรวจพบ | ประมาณการ MVP |
|---|---|---|
| Supabase | Free plan (มีข้อจำกัดพื้นที่และ project ที่ไม่ใช้งานอาจถูก pause) | 0 บาท |
| Google TTS Chirp 3 HD | ฟรี 1M ตัวอักษร/เดือน แล้ว US$30/1M | สคริปต์ 30–45 วิ ≈ 300–500 ตัวอักษร → 100 คลิป/เดือน ≈ 50k ตัวอักษร → **0 บาท** (อยู่ใน free tier) |
| Google TTS Standard | ฟรี 4M ตัวอักษร/เดือน แล้ว US$4/1M | ใช้เป็น fallback ราคาถูก |
| Remotion | ฟรีสำหรับบุคคล / บริษัท ≤ 3 คน; ถ้าเกิน: Automators US$0.01/render ขั้นต่ำ US$100/เดือน | 0 บาท (ถ้าเข้าเงื่อนไข free) — **ถ้าไม่เข้าเงื่อนไขจะเกินงบ** |
| Render | เครื่องตัวเอง | 0 บาท (ค่าไฟ) |
| LLM (M3+, optional) | ยังไม่เลือก | ตั้ง budget cap; template เป็นค่าเริ่มต้น |

ระบบจะบันทึก usage + ประมาณค่าใช้จ่ายทุกครั้ง (M4–M5) และมี daily/monthly cap

## 6. ความเสี่ยง

| ความเสี่ยง | ผลกระทบ | การรับมือ |
|---|---|---|
| ไม่ได้สิทธิ์ Shopee Open API ของไทย | ต้องนำเข้าด้วย CSV ต่อ | CSV import ใช้งานได้จริงแล้ว; adapter interface พร้อมเสียบ |
| ราคา/ค่าคอมใน CSV เก่า | แนะนำสินค้าผิด | ป้าย “ข้อมูลเก่า” + `retrieved_at` + ประวัติราคา |
| Remotion license ถ้าเป็นบริษัท > 3 คน | ค่าใช้จ่าย ≥ US$100/เดือน | ยืนยันสถานะผู้ใช้ก่อน M4; ทางเลือก: FFmpeg-only templates |
| ฟอนต์/ตัดคำภาษาไทยในซับ | ซับล้น/ตัดคำผิด | `Intl.Segmenter('th')` + QA ตรวจ overflow |
| เนื้อหาโฆษณาเกินจริง/ข้อมูลแต่ง | ผิดกฎแพลตฟอร์ม/กฎหมาย | claims review + affiliate disclosure บังคับใน template |
| ข้อมูลผู้ใช้รั่ว | ร้ายแรง | RLS ทุกตาราง + ตรวจ user ฝั่ง server + test isolation อัตโนมัติ |
| FFmpeg ไม่มีในเครื่อง | M4 ทำงานไม่ได้ | ติดตั้งก่อนเริ่ม M4 |

## 7. Milestones และ acceptance criteria

| # | ขอบเขต | Acceptance |
|---|---|---|
| **M1 Foundation** ✅ | Supabase, Auth, migrations, RLS, Product CRUD, CSV import, dashboard, validation | Login/logout ได้; route ถูกป้องกัน; เพิ่ม/แก้/ลบสินค้าได้; CSV map คอลัมน์ได้, แยกแถวผิด, ตรวจซ้ำ (ข้าม/อัปเดต), สรุปผล; สถานะข้อมูลแยกชัด; user B อ่าน/แก้ข้อมูล user A ไม่ได้ (test จริง); lint/typecheck/build/tests ผ่าน |
| M2 Product Research | Source adapter abstraction, Shopee feed (เมื่อยืนยันสิทธิ์), freshness, Opportunity Score, trend adapter | Score คำนวณจากฟิลด์ที่มีจริงเท่านั้น แสดงเหตุผล+ข้อจำกัด; ฟิลด์ขาด → ลดความเชื่อมั่น ไม่เติมค่า; trend ไม่มี → unavailable |
| M3 Content Planning | 6 templates, storyboard schema, Thai script, fact validation, edit/approve, LLM interface | สร้าง storyboard จาก template ได้; ทุก claim อ้าง fact ของสินค้า; ต้อง approve ก่อน render; มี affiliate disclosure |
| M4 Video Engine | Remotion, Google TTS, Thai subtitles, FFmpeg, worker, job status, MP4, preview/download, rerender | MP4 1080×1920@30 H.264/AAC เล่นได้; timing จากความยาวเสียงจริง; QA report; แก้ scene แล้ว rerender; error อ่านเข้าใจได้; ไม่มี credentials → แจ้งว่า TTS ยังไม่เชื่อมต่อ |
| M5 Workflow Automation | queue, retries, assets, usage, cost limits, approval | idempotency; bounded retry; เกิน cap → หยุดพร้อมข้อความ |
| M6 Publishing | manual export (MP4/caption/thumbnail/affiliate URL), บันทึกสถานะเผยแพร่เอง, platform adapters เมื่อมีสิทธิ์ | ไม่โพสต์ซ้ำ; ไม่มี auto-post ถ้าไม่มี OAuth/สิทธิ์ |
| M7 Analytics | CSV import ผลลัพธ์, metrics ตามที่มีจริง | แยก attributed conversions จากยอดรวม; cost ต่อวิดีโอ |
| M8 Production readiness | security review, monitoring, backup, deploy docs | — |

## 8. Dependencies และ credentials ที่ต้องเตรียม

| เมื่อ | สิ่งที่ต้องมี | ใครทำ |
|---|---|---|
| ตอนนี้ (local) | Docker Desktop เปิดอยู่ | ✅ มีแล้ว |
| ก่อน deploy | Supabase cloud project + URL/anon key; ตั้ง Site URL/Redirect URLs | ผู้ใช้ |
| M2 | ยืนยันสิทธิ์ Shopee Affiliate Open API (AppID/Secret) ของบัญชีไทย; สมัคร Google Trends API alpha (ถ้าต้องการ) | ผู้ใช้ |
| M4 | ติดตั้ง FFmpeg (`winget install Gyan.FFmpeg`); Google Cloud project + billing + เปิด Text-to-Speech API + service account JSON; ยืนยันเงื่อนไข Remotion license | ผู้ใช้ |
| M3 (optional) | LLM API key + budget cap | ผู้ใช้ |
