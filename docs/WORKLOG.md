# Worklog

บันทึกการทำงาน การตัดสินใจ และปัญหาที่เจอ — รายละเอียดว่าทำอะไรเสร็จแล้วดูที่ [CHECKLIST.md](CHECKLIST.md), แผนรวมที่ [PLAN.md](PLAN.md), วิธีรันที่ [SETUP.md](SETUP.md)

---

## สถานะตอนพัก (2026-10-20)

- **เสร็จ:** Phase 0, M1 Foundation, M2 Product Research (ยกเว้น Shopee API), M3 Content Planning, M4 Video Engine (ยังไม่มีเสียงพากย์), M5 Workflow Automation
- **ยังไม่เริ่ม:** M6 Publishing, M7 Analytics, M8 Production readiness
- **รอคนตัดสินใจ/ข้อมูลจากภายนอก:** สิทธิ์ Shopee Affiliate Open API (TH), ผู้ให้บริการ TTS, บัญชี Anthropic API (ถ้าจะให้ AI เขียนผ่านปุ่มโดยตรง), Supabase cloud project (ตอน deploy)
- **ผลตรวจล่าสุด:** lint ✅ typecheck ✅ build ✅ · unit 80 ✅ · RLS 14 ✅ · e2e 7 specs ✅ (รัน 2 รอบ) · `supabase db diff` ไม่มี drift ของตาราง/constraint
- **สภาพแวดล้อม:** ใช้ Supabase local เท่านั้น (Docker, พอร์ต 553xx), FFmpeg 9.0.2 ติดตั้งผ่าน winget, Remotion 4.0.537 (Free License), Chrome Headless Shell ของ Remotion ดาวน์โหลดแล้ว

### กลับมาทำต่อ

```bash
npm run db:start                 # Docker ต้องเปิดอยู่
npm run dev                      # http://localhost:3000
npm run worker                   # terminal ที่สอง — ต้องเปิดไว้ถึงจะ render วิดีโอได้
```

ถ้า terminal เก่าหา `ffprobe` ไม่เจอ ให้เปิด terminal ใหม่ (PATH ถูกเพิ่มหลังติดตั้ง) หรือตั้ง `FFPROBE_PATH`

**ห้ามรัน `npm run db:reset` โดยไม่ตั้งใจ — ลบข้อมูล local ทั้งหมด** ใช้ `npx supabase migration up` เวลามี migration ใหม่

### ขั้นต่อไปที่แนะนำ

1. **M6 Publishing** — ส่งออกชุดโพสต์ (MP4 + แคปชันพร้อม disclosure + ภาพปก + ลิงก์ affiliate), บันทึกสถานะโพสต์เอง (`publications`), ไม่มี auto-post จนกว่าจะมี OAuth/สิทธิ์
2. **เสียงพากย์** — เลือก Google Cloud TTS หรือ Azure Speech → ทำ `TtsProvider` + `tts_cache`, เวลาในวิดีโอใช้ความยาวเสียงจริง (`audioSeconds` ใน timeline รองรับแล้ว)
3. M7 Analytics, M8 Production readiness (security review, backup, deploy)

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
