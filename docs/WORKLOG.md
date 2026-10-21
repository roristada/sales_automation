# Worklog

บันทึกการทำงาน การตัดสินใจ และปัญหาที่เจอ — รายละเอียดว่าทำอะไรเสร็จแล้วดูที่ [CHECKLIST.md](CHECKLIST.md), แผนรวมที่ [PLAN.md](PLAN.md), วิธีรันที่ [SETUP.md](SETUP.md)

---

## สถานะตอนพัก (2026-10-21)

- **เสร็จ:** Phase 0, M1 Foundation, M2 Product Research (ยกเว้น Shopee API), M3 Content Planning, M4 Video Engine (ยังไม่มีเสียงพากย์), M5 Workflow Automation, M6 Publishing (โพสต์เอง), M7 Analytics (CSV), M8 Production readiness (ส่วนที่ทำบนเครื่องได้)
- **รอคนตัดสินใจ/ข้อมูลจากภายนอก:** สิทธิ์ Shopee Affiliate Open API (TH), ผู้ให้บริการ TTS, บัญชี Anthropic API (ถ้าจะให้ AI เขียนผ่านปุ่มโดยตรง), Supabase cloud project (ตอน deploy)
- **ผลตรวจล่าสุด:** lint ✅ typecheck ✅ build ✅ · unit 105 ✅ · RLS 18 ✅ · e2e 10 specs ✅ · `npm audit --omit=dev` 0 · backup + restore ทดสอบจริงแล้ว
- **สภาพแวดล้อม:** ใช้ Supabase local เท่านั้น (Docker, พอร์ต 553xx), FFmpeg 9.0.2 ติดตั้งผ่าน winget, Remotion 4.0.537 (Free License), Chrome Headless Shell ของ Remotion ดาวน์โหลดแล้ว

### กลับมาทำต่อ

```bash
npm run db:start                 # Docker ต้องเปิดอยู่
npm run dev                      # http://localhost:3000
npm run worker                   # terminal ที่สอง — ต้องเปิดไว้ถึงจะ render วิดีโอได้
npm run backup                   # สำรองข้อมูล (ควรตั้งเวลาทุกวัน — docs/DEPLOY.md)
```

ถ้า terminal เก่าหา `ffprobe` ไม่เจอ ให้เปิด terminal ใหม่ (PATH ถูกเพิ่มหลังติดตั้ง) หรือตั้ง `FFPROBE_PATH`

**ห้ามรัน `npm run db:reset` โดยไม่ตั้งใจ — ลบข้อมูล local ทั้งหมด** ใช้ `npx supabase migration up` เวลามี migration ใหม่

### ขั้นต่อไปที่แนะนำ

1. **ใช้งานจริง** — ทดลองทำวิดีโอ → โพสต์ → นำเข้าผล แล้วปรับตามไฟล์ export จริงของ Shopee/TikTok (หัวคอลัมน์ยังเดาจากรูปแบบที่พบบ่อย)
2. **เสียงพากย์** — ทำแล้วผ่าน OpenRouter TTS (AI-5, docs/AI_VIDEO_PLAN.md) — เหลือฟังเทียบเสียงแล้วเลือกค่าเริ่มต้น
3. **Deploy** เมื่อต้องการเปิด 24 ชม. หรือเข้าจากมือถือ — ทำตาม docs/DEPLOY.md (ตั้ง `BACKUP_DIR` ไปไดรฟ์อื่นก่อน)

---

## การตัดสินใจ

| เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|
| ฐานข้อมูล | Supabase local ก่อน ยังไม่สร้าง cloud | พัฒนาและทดสอบ RLS ได้โดยไม่มีค่าใช้จ่าย; RLS test ปฏิเสธ URL ที่ไม่ใช่ local |
| ข้อมูลสินค้า | นำเข้า CSV จนกว่าจะยืนยันสิทธิ์ Shopee Open API ไทย | ไม่พบ API สาธารณะของไทย; ห้าม scrape |
| เทรนด์ | นำเข้า CSV ที่ export จาก Google Trends | Google Trends API ยังเป็น alpha ต้องสมัคร |
| Opportunity Score | คำนวณจากฟิลด์ที่มีจริงเท่านั้น ข้อมูลขาด → ลดความเชื่อมั่น ไม่เติมค่า; ไม่รวมเทรนด์ (v1) | ห้ามแต่งข้อมูล; ค่าเทรนด์ของ Google เทียบข้ามไฟล์ไม่ได้ |
| น้ำหนักคะแนน / ช่วงราคา | ค่าตั้งต้นที่กำหนดเอง (ค่าคอม/ชิ้น 40, อัตรา 20, ราคา 20, ความพร้อม 20) | ยังไม่มีผลขายจริงมาปรับ — แก้ที่ `opportunity-score.ts` แล้วเพิ่ม `SCORE_VERSION` |
| สคริปต์ | template 6 แบบ ภาษาไทย ทุก claim ต้องอ้างข้อเท็จจริงและตรวจก่อนอนุมัติ | กันเนื้อหาเกินจริง/ข้อมูลแต่ง (ความเสี่ยงด้านกฎหมาย/แพลตฟอร์ม) |
| AI ช่วยเขียน | ปุ่มคัดลอกคำสั่ง → วางใน claude.ai → วางคำตอบกลับ | ผู้ใช้มี Claude Pro แต่ไม่มี API (Pro ไม่รวมสิทธิ์ API และห้ามใช้ login ของ Pro ในแอป); interface `LlmProvider` พร้อมเสียบเมื่อมี API key |
| Render | Remotion (Free License) + worker แยก process + คิวใน Postgres | ผู้ใช้ใช้คนเดียว → เข้าเงื่อนไขฟรี; ไม่ต้องเพิ่ม Redis |
| เสียงพากย์ | ทำวิดีโอไม่มีเสียงพากย์ก่อน (มีแทร็ก AAC เงียบ + ซับไทย) | ยังไม่มีบัญชี TTS; ต่อทีหลังได้โดยไม่แก้ส่วนอื่น |
| ที่เก็บไฟล์ | ดิสก์ในเครื่อง (`storage/renders`) ผ่าน `StorageAdapter` | เครื่องเดียว; เปลี่ยนเป็น object storage ได้ตอน deploy |
| สิทธิ์ไฟล์ในคลัง | ค่าเริ่มต้น "ไม่ทราบสิทธิ์"; ห้ามใช้เชิงพาณิชย์ → อนุมัติ/render ไม่ได้ | วิดีโอ affiliate เป็นงานเชิงพาณิชย์ (design.md §9.7) |
| ค่าใช้จ่าย | บันทึกทุก render; เพดานหยุดเฉพาะงานที่มีค่าใช้จ่าย; render ในเครื่อง = ฿0 | ตามงบ 0–1,000 บาท/เดือน; ไม่บล็อกงานฟรี |
| เผยแพร่ | โพสต์เองแล้ววางลิงก์โพสต์กลับมา; ไม่มี auto-post | TikTok/Meta/YouTube ต้องใช้ OAuth + ผ่านการตรวจแอปก่อนโพสต์สาธารณะได้; สถานะ “เผยแพร่แล้ว” มาจากลิงก์ที่ผู้ใช้บันทึกเท่านั้น (design.md §9.8) |
| กันโพสต์ซ้ำ | 1 รายการต่อคอนเทนต์ต่อแพลตฟอร์ม (ไม่นับที่ลบโพสต์แล้ว) + ลิงก์โพสต์ห้ามซ้ำ | render ใหม่ของคอนเทนต์เดิม = วิดีโอเดิม; อยากโพสต์ใหม่ให้บันทึกว่าลบโพสต์เก่าก่อน |
| Attribution ค่าคอม | นับให้วิดีโอเฉพาะคำสั่งซื้อที่มีรหัสติดตามของวิดีโอใน Sub_id | วิธีเดียวที่พิสูจน์ได้จากรายงาน Shopee; ที่เหลือนับในยอดรวม “ไม่ระบุวิดีโอ” ไม่เดา |
| Deploy | เครื่องตัวเอง + Supabase local ก่อน (มือถือผ่าน Tailscale); ไม่เปิดสู่อินเทอร์เน็ตจนกว่าจะปิดสมัคร + HTTPS | งบ 0–1,000 บาท; ไฟล์อยู่บนดิสก์ แอปกับ worker ต้องอยู่เครื่องเดียวกัน |
| Backup | `pg_dump` (public + บัญชี) + copy ไฟล์ ทดสอบกู้คืนลง DB ชั่วคราวทุกครั้ง; restore เฉพาะ DB ว่าง | backup ที่ไม่เคยทดสอบกู้คืนเชื่อไม่ได้; กันการ restore ทับข้อมูลจริง (เคยเสียข้อมูลจาก db reset) |
| Monitoring | heartbeat ของ worker ใน Postgres + หน้า สถานะระบบ + `/api/health` | ไม่ต้องเพิ่มบริการ; ตอบคำถามที่เจอจริงบ่อยสุด “ทำไมงานค้างรอคิว” |
| ผลโพสต์ | นำเข้า CSV ที่ export เอง เก็บเป็นยอดสะสมรายวัน ใช้ค่าล่าสุด | ยังไม่มีสิทธิ์ API ของแพลตฟอร์ม; export เป็นยอดสะสมจึงห้ามบวกข้ามวัน |

---

## ปัญหาที่เจอและวิธีแก้

| ปัญหา | สาเหตุ | แก้ |
|---|---|---|
| `supabase db reset` ลบข้อมูล local ทั้งหมด (ช่วง M2) | reset สร้าง DB ใหม่จาก migration | เปลี่ยนเป็น `supabase migration up`; ใส่คำเตือนใน SETUP |
| ลบสินค้าไม่ได้เมื่อมี claim อ้างข้อเท็จจริง (`23503`) | FK ถูกตรวจก่อนที่ cascade จะลบ claim ทัน | FK `scene_claims.fact_id` และ `storyboard_scenes.asset_id` เป็น `deferrable initially deferred` |
| แก้ข้อเท็จจริงแล้วการ reset claim เป็น "รอตรวจ" ล้มทั้ง statement | trigger ล็อกสคริปต์ที่อนุมัติแล้วบล็อกการ update | reset เฉพาะ claim ในสคริปต์ฉบับร่าง |
| ตัวเลขลำดับใน template ("1.", "3 จุดเด่น") บังตัวเลขที่ไม่มีหลักฐานในคำพูด | literal ของ template ถูกยกเว้นทุกช่อง | ยกเว้นเฉพาะ Hook และข้อความบนจอ |
| ความยาวฉากที่บอก AI สั้นเกินไป | คิดจากข้อความเดิมของฉาก | ใช้ส่วนแบ่งของความยาวเป้าหมาย |
| Hook ยาวทับรูปสินค้า / ถูกตัดด้วย "…" | layout คงที่ | ขยับการ์ดลง + ลดขนาดตัวอักษรตามความยาว Hook |
| เซิร์ฟเวอร์ uncaught exception `Controller is already closed` | `Readable.toWeb` ตอนเบราว์เซอร์ยกเลิก range request ของวิดีโอ | สตรีมไฟล์แบบรองรับการยกเลิก (`serve-file.ts`) |
| e2e render ล้มเป็นบางครั้ง | test รันขนานกันบนคิวเดียว worker ของอีก test หยิบงานไป / Player preview มี `<video>` ด้วย | รอผลลัพธ์แทนการเช็ก log; เลือก `video[src*="/api/renders/"]` |
| **Security review:** open redirect หลัง login (`/\evil.com` ผ่านการตรวจเดิม) | เช็กแค่ขึ้นต้น `/` และไม่ใช่ `//` | `src/lib/safe-redirect.ts` ปฏิเสธ backslash/control chars และต้อง resolve เป็น origin เดิม |
| **Security review:** SSRF — worker โหลดรูปจาก `image_url` ที่ผู้ใช้ใส่ได้ทุกที่รวมถึง localhost/เครือข่ายภายใน | ใช้ `fetch` ตรงๆ ตาม redirect | `fetchPublic` (`safe-fetch.ts`): อนุญาตเฉพาะ IP สาธารณะ ตรวจตอนเชื่อมต่อจริงทุก redirect hop, จำกัดขนาด/เวลา |
| **Security review:** ปลอม `storage_key` ของ asset ผ่าน API ให้ชี้ไฟล์ของผู้ใช้อื่นแล้วดาวน์โหลด | insert ผ่าน PostgREST ได้โดยไม่ตรวจรูปแบบ key | migration `20261025000000_asset_key_guard.sql` บังคับ key = `<owner>/<id>/original.<ext>` + mime ที่รับ; route ตรวจ prefix ซ้ำ; มี RLS test |
| Upload ใหญ่ผ่าน middleware ถูกตัด | Next 15 buffer body ใน middleware สูงสุด 10 MB | `experimental.middlewareClientMaxBodySize: "210mb"` |
| render ล้ม `Jest worker encountered 2 child process exceptions` (stack ชี้ไป `remi_shop`) | dev server ของ remi_shop ฟัง `0.0.0.0:3000`; Remotion ตรวจพอร์ตเฉพาะ 127.0.0.1 ซึ่ง Windows ยอมให้ bind ซ้อน → Chrome โหลดแอปอื่นแทน bundle | worker หาพอร์ตว่างจริงจาก OS แล้วส่ง `port` ให้ Remotion ทุกครั้ง |
| สถานะ worker แสดง “ยังไม่เคยเปิด” หลังปิด worker ปกติ | worker ลบแถว heartbeat ตอนหยุด | รวมเป็น “ไม่ได้เปิด” สถานะเดียว |
| e2e M8 ถูก skip/สุ่มพัง | spec อื่นรัน worker จริงพร้อมกัน สถานะ worker ส่วนกลางจึงบังคับให้ offline ไม่ได้ | ตรวจความสอดคล้องของคำตอบแทน แล้วเพิ่ม heartbeat ของ test เองเพื่อตรวจ online |
| **M8 security review:** ไม่มี security headers, CSV formula injection, `javascript:` URL ผ่าน API, ใครก็สมัครได้, postcss มีช่องโหว่ | — | ดู docs/SECURITY.md |
| สิทธิ์ UPDATE ทั้งตาราง `publications` ยังอยู่แม้ grant รายคอลัมน์ | default privileges ของ Supabase ให้ทุกสิทธิ์กับ `authenticated` | `revoke update` ก่อน grant รายคอลัมน์ (แบบเดียวกับ `assets`); มี RLS test |

---

## บันทึกรายวัน

### 2026-10-20

- Phase 0 + M1 (ทำไว้ก่อนแล้ว): Auth, products, CSV import, RLS, dashboard, UI pass ตาม design.md
- M2: adapter registry, Opportunity Score + `opportunity_scores` + `research_products`, หน้าแหล่งข้อมูล/ความใหม่ + ส่งออก CSV สินค้าเก่า → นำเข้ากลับด้วย System ID, เทรนด์จาก Google Trends CSV + กราฟ + ผูกคีย์เวิร์ดกับสินค้า
- M3: ข้อเท็จจริงสินค้า, template 6 แบบ, Script Studio (claims, ตรวจ, อนุมัติ/ล็อก, เวอร์ชัน), ปุ่ม AI ช่วยเขียนแบบคัดลอกคำสั่ง
- M4: Remotion composition, worker, คิว render, QA ด้วย ffprobe, Video Studio, ดาวน์โหลด MP4/JPG/SRT/VTT; ติดตั้ง FFmpeg
- M5: คลังไฟล์ + สิทธิ์การใช้งาน, ใส่รูป/คลิปในฉาก, usage log, เพดานค่าใช้จ่าย
- เริ่มใช้ git (commit แรก = สถานะ ณ จุดพักนี้), เพิ่มไฟล์นี้
- แก้ 3 ประเด็นจาก security review อัตโนมัติ (open redirect, SSRF, asset storage_key) — ดูตารางปัญหาด้านบน
- security review รอบสอง: redirect ที่ normalize แล้วกลายเป็น `//evil.com` (`/.//evil.com`, `/%2e//…`) → ตรวจผลลัพธ์หลัง normalize ซ้ำ; ดาวน์โหลดรูปใช้ timeout แบบ idle (เซิร์ฟเวอร์ส่งทีละไบต์ค้างได้) → เปลี่ยนเป็นเส้นตายรวมด้วย `AbortSignal.timeout`
- M6: ตาราง `publications` + หน้าเผยแพร่ (ชุดไฟล์ + แคปชัน + ลิงก์, ตั้งเวลาแบบเตือน, บันทึกลิงก์โพสต์, ลบโพสต์/โพสต์ใหม่), adapter ของ 3 แพลตฟอร์มแสดง “ยังไม่เชื่อมต่อ”; แก้พอร์ตชนของ Remotion
- M7: Analytics จาก CSV (ผลโพสต์ + รายงาน Conversion ของ Shopee), รหัสติดตามต่อวิดีโอ, แยกค่าคอมที่มาจากวิดีโอออกจากยอดรวม, ค่าใช้จ่ายและสุทธิต่อวิดีโอ

### 2026-10-21

- M8: security review (headers, CSV formula escaping, DB URL scheme checks, `DISABLE_SIGNUP`, postcss override) → docs/SECURITY.md; worker heartbeat + Settings “สถานะระบบ” + `/api/health`; `npm run backup` (ทดสอบกู้คืนทุกครั้ง) / `npm run restore` (ทดสอบกู้คืนจริงลง DB ชั่วคราวแล้ว); docs/DEPLOY.md

### 2026-10-22

- AI-1: client OpenRouter, ตั้งค่าโมเดลต่องานจาก catalog จริง, `ai_settings`/`ai_requests`, ค่าใช้จ่าย AI รวมเข้าเพดานเดิม, ปุ่มทดสอบเรียกจริง — ตรวจ catalog วันนี้: รุ่นตามแผนมีครบ (DeepSeek V4.1 Flash, GLM 5.3 Flash, Kling v3.0 std, Veo 3.1 Fast/Lite)
- AI-2: ปุ่ม AI เรียก API ตรง (ดึงข้อเท็จจริงจากคำอธิบาย+รูป, เขียนทีละฉาก, เขียนทั้งสคริปต์พร้อมตัวอย่างก่อนใช้), เทียบโมเดลกับสคริปต์ Edifier: DeepSeek ฿0.017 / Haiku ฿0.063 ใช้ได้ทั้งคู่ — เครดิต OpenRouter เกือบหมด ยังเทียบ Qwen/Sonnet ไม่ได้
- AI-3 (โค้ด+เทส): แผนภาพต่อฉาก, คิวสร้างคลิป AI ผ่าน OpenRouter ใน worker, ตรวจ/อนุมัติ/สร้างใหม่ทีละฉาก — ทดสอบ pipeline กับ OpenRouter ปลอม; ยังไม่ได้สร้างคลิปจริงเพราะยังไม่เติมเครดิต
- AI-4: render ใช้คลิป AI ที่อนุมัติแทนภาพของฉาก, บล็อก render ถ้าฉาก AI ยังไม่มีคลิปอนุมัติ, QA ตรวจ, แคปชันบอกว่ามีภาพ AI — ทดสอบ render จริงด้วยคลิปทดสอบ
- AI-5 (โค้ด+เทส): เสียงพากย์ไทยผ่าน OpenRouter TTS ใน worker (cache ต่อประโยค, จังหวะตามความยาวเสียงจริง, บันทึกค่าใช้จ่าย) + เพลงประกอบจากคลังไฟล์ — Gemini TTS ต้องมีเครดิต; โมเดลฟรี Fish Audio S2.1 เรียกได้จริงแล้ว แต่ยังไม่ได้ฟังว่าออกเสียงไทยดีไหม
