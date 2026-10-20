# Security review (M8, 2026-10-21)

ทบทวนทั้งระบบก่อนใช้งานจริง ครอบคลุม M1–M7 และรวมผลจาก review สองรอบก่อนหน้า (ดู WORKLOG → ปัญหาที่เจอ) วิธี deploy อย่างปลอดภัยดูที่ [DEPLOY.md](DEPLOY.md) ข้อ 4

## ขอบเขตความเชื่อถือ

| ส่วน | สิทธิ์ | สิ่งที่ป้องกัน |
|---|---|---|
| เบราว์เซอร์ | ไม่ได้คุยกับ Supabase โดยตรง ทุก query ผ่าน server ของ Next.js ด้วย session ของผู้ใช้ (anon key + JWT) | RLS ทุกตาราง ทดสอบการแยกข้อมูลอัตโนมัติด้วยผู้ใช้ A/B (`tests/rls`, 18 กรณี) |
| Server actions / routes | ทำงานเป็นผู้ใช้ที่ล็อกอินอยู่ ไม่มีการใช้ service-role key ใน `src/` | `getUser()` ตรวจกับ Auth server, zod validate ทุก input, login ผิดได้ข้อความกลาง ไม่บอกว่าอีเมลมีอยู่ในระบบไหม (หน้าสมัครยังบอกได้ — ปิดสมัครเมื่อใช้งานจริง) |
| Render worker | service role (ข้าม RLS) แยก process | อ่าน/เขียนเฉพาะงานที่ claim ได้, `fetchPublic` กัน SSRF, ไฟล์ asset เสิร์ฟผ่าน loopback ด้วย token ต่องาน |
| Database | constraints + triggers เป็นด่านสุดท้าย | ค่าที่ผู้ใช้ปลอมไม่ได้ (owner, disclosure, storage key, สถานะที่ล็อก) ถูกกำหนดใน SQL ไม่ใช่แค่ใน UI |

## ผลตรวจรอบนี้

| ประเด็น | ความเสี่ยง | สถานะ |
|---|---|---|
| ไม่มี security headers (clickjacking, MIME sniffing, Referer รั่ว) | กลาง | **แก้แล้ว** — `next.config.ts`: `frame-ancestors 'none'` + `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS ในโหมด production, ปิด `X-Powered-By`; มี e2e |
| CSV formula injection — ส่งออกสินค้าที่ชื่อ/หมายเหตุมาจาก CSV ภายนอก (`=HYPERLINK(...)`) แล้วเปิดใน Excel/Sheets | กลาง | **แก้แล้ว** — `escapeFormulae` ตอนส่งออก, ตอนนำเข้าตัด `'` ที่ระบบใส่ออก (ส่งออก→นำเข้ากลับได้ค่าเดิม); unit test |
| `javascript:` / `data:` URL ในลิงก์สินค้า/แหล่งที่มา ถ้าเขียนผ่าน API ตรง (ฟอร์มกันอยู่แล้ว) | ต่ำ (self-XSS เพราะ RLS จำกัดให้เห็นเฉพาะข้อมูลตัวเอง) | **แก้แล้ว** — migration `20261029000000_url_scheme_guard.sql` บังคับ `http(s)://` ใน DB; RLS test |
| ใครก็สมัครบัญชีได้ → ใช้ render/ดิสก์ของเครื่อง | สูง ถ้าเปิดสู่อินเทอร์เน็ต | **แก้แล้ว (ต้องตั้งค่า)** — `DISABLE_SIGNUP=true` ซ่อน/ปฏิเสธการสมัครในแอป + ต้องปิด sign-up ใน Supabase Auth (DEPLOY.md ข้อ 4) |
| `postcss` < 8.5.23 (ผ่าน `next`) — GHSA-qx2v-qp2m-jg93 และอื่นๆ | ต่ำ (ประมวลผลเฉพาะ CSS ของเราตอน build) | **แก้แล้ว** — `overrides.postcss ^8.5.31`; `npm audit --omit=dev` = 0 |
| ช่องโหว่ใน dev dependencies (vitest/tinypool, braces ฯลฯ) | ต่ำ (ใช้เฉพาะตอนทดสอบบนเครื่อง ไม่อยู่ในแอปที่รัน) | **ยอมรับ** — อัปเกรด vitest เป็นเวอร์ชันหลักใหม่ภายหลัง |
| ไม่มี CSP สำหรับ script | ต่ำ | **ยอมรับ** — Next.js ใส่ inline script; React escape ข้อความทั้งหมด ไม่มี `dangerouslySetInnerHTML`; ทำ CSP แบบ nonce ได้ภายหลัง |
| ไม่มี rate limit ของแอป | ต่ำ | **ยอมรับ** — login มี rate limit ของ Supabase Auth; server actions ต้องล็อกอิน; คนเดียวใช้ |
| `/api/health` ไม่ต้องล็อกอิน | ต่ำ | ตั้งใจ — ตอบแค่ up/down ของ DB และ worker ไม่มีชื่อเครื่อง เวลา หรือข้อมูลผู้ใช้ (`worker_heartbeats` อ่านตรงไม่ได้; RLS test) |
| Backup มีบัญชีผู้ใช้ + hash รหัสผ่าน | กลาง | `backups/` อยู่ใน `.gitignore`; DEPLOY.md เตือนให้เก็บในที่ปลอดภัย |

## ตรวจซ้ำแล้วไม่พบปัญหา

- Open redirect หลัง login, SSRF ใน worker, ปลอม `storage_key` ของไฟล์ (แก้ในรอบก่อน, มี test)
- ไฟล์ render/asset: route ตรวจความเป็นเจ้าของผ่าน RLS ก่อนเสิร์ฟ, key ผ่าน regex ไม่มี path traversal, ชื่อไฟล์ดาวน์โหลด encode แล้ว
- เผยแพร่/Analytics (M6–M7): ลิงก์โพสต์ต้อง https บนโดเมนของแพลตฟอร์มจริง, disclosure บังคับใน SQL, ผูกคำสั่งซื้อกับ publication ของคนอื่นไม่ได้, คอลัมน์ที่ระบบคำนวณแก้ไม่ได้ (column grants)
- ขนาด input: CSV ≤ 2.5–3 MB, upload ≤ 200 MB, ข้อความทุกช่องมี `char_length` check
- ไม่มี secret ใน repo (`.env*` ถูก ignore ยกเว้น `.env.example`)

## ยังไม่ได้ตรวจ (ต้องทำเมื่อมี)

- OAuth ของแพลตฟอร์ม (M6 adapters), Shopee Open API, TTS — ตรวจการเก็บ token/secret ตอนเชื่อมต่อจริง
- การตั้งค่า Supabase cloud จริง (Auth settings, network restrictions) — ทำตาม DEPLOY.md ข้อ 4–5 แล้วทดสอบด้วยบัญชีที่สอง
