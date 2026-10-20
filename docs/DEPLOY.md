# Deploy, monitoring และ backup

คู่มือใช้งานจริง (M8) — วิธีติดตั้งพื้นฐานดูที่ [SETUP.md](SETUP.md), ผลตรวจความปลอดภัยดูที่ [SECURITY.md](SECURITY.md)

## 1. ข้อจำกัดของสถาปัตยกรรมที่ต้องรู้ก่อน deploy

- **เว็บแอปและ render worker ต้องอยู่เครื่องเดียวกัน** — วิดีโอ ภาพปก และไฟล์ในคลังเก็บบนดิสก์ (`storage/renders`, `RENDER_STORAGE_DIR`) แอปอ่านไฟล์จากดิสก์นั้นโดยตรง จึงใช้ Vercel/serverless ไม่ได้จนกว่าจะเปลี่ยน `StorageAdapter` เป็น object storage
- worker ต้องมี FFmpeg (ffprobe) และ Chrome Headless Shell ของ Remotion (ดาวน์โหลดเองครั้งแรก) ต้องใช้ RAM อย่างน้อย 2–4 GB ขณะ render
- เบราว์เซอร์ไม่คุยกับ Supabase โดยตรง ทุก query ผ่าน server ของ Next.js — เปิดให้เข้าถึงจากภายนอกแค่พอร์ตของแอปก็พอ ไม่ต้องเปิด Supabase
- Remotion Free License ใช้ได้เฉพาะบุคคล/บริษัทไม่เกิน 3 คน ([LICENSING.md](LICENSING.md))

## 2. ทางเลือก (เรียงจากแนะนำ)

| แบบ | ค่าใช้จ่าย | เหมาะกับ |
|---|---|---|
| **A. เครื่องตัวเอง + Supabase local** (ตอนนี้) | ฿0 | ใช้คนเดียว เปิดเครื่องตอนทำงาน |
| B. แบบ A + เข้าจากมือถือผ่าน Tailscale | ฿0 (Tailscale Personal ฟรี) | อยากเปิดดู/อนุมัติจากมือถือ โดยไม่เปิดสู่อินเทอร์เน็ต |
| C. แบบ A + Supabase cloud (Free plan) | ฿0 (pause อัตโนมัติถ้าไม่ใช้ 1 สัปดาห์) | อยากให้ฐานข้อมูลอยู่นอกเครื่อง |
| D. VPS (แอป + worker + Supabase local หรือ cloud) | ประมาณ ฿200–700/เดือนสำหรับ 2 vCPU/4 GB | เปิดตลอด 24 ชม. |

แนะนำให้ใช้แบบ A หรือ B ไปก่อน จนกว่าจะต้องให้ระบบเปิดตลอดเวลา **อย่าเปิดแอปสู่อินเทอร์เน็ตสาธารณะ** (เช่นผ่าน port forward) ถ้ายังไม่ได้ทำครบตามข้อ 4

## 3. รันแบบ production บนเครื่อง (แบบ A/B)

```bash
npm run db:start                  # Docker Desktop ต้องเปิดอยู่
npm run build
npm start                         # http://localhost:3000 (โหมด production: เร็วกว่า dev, มี HSTS)
npm run worker                    # อีก terminal — ต้องเปิดไว้ถึงจะ render ได้
```

ให้เปิดเองตอนบูตเครื่อง (Windows): สร้าง Task Scheduler 2 งาน "At log on" → Program `cmd.exe`, Arguments `/c cd /d E:\Project_IS\sales_automation && npm start` และอีกงานใช้ `npm run worker` (Docker Desktop ตั้ง "Start when you sign in" ไว้)

**เข้าจากมือถือ (แบบ B):** ติดตั้ง Tailscale บนคอมกับมือถือ แล้วล็อกอินบัญชีเดียวกัน เปิด `http://<ชื่อเครื่อง>:3000` จากมือถือ → แอปเข้าได้เฉพาะอุปกรณ์ของคุณ ถ้าต้องการ HTTPS ใช้ `tailscale serve 3000`

## 4. เช็กลิสต์ก่อนให้คนอื่นเข้าถึงได้ (แบบ C/D หรือเปิดสาธารณะ)

1. สร้างบัญชีของตัวเองก่อน แล้ว**ปิดการสมัคร**ทั้งสองที่:
   - แอป: `DISABLE_SIGNUP=true` ใน env (ซ่อนปุ่มและปฏิเสธการสมัคร)
   - Supabase: Authentication → Sign In / Providers → ปิด "Allow new users to sign up" (local: `enable_signup = false` ใน `supabase/config.toml` ทั้ง `[auth]` และ `[auth.email]` แล้ว `npm run db:stop && npm run db:start`) — **ต้องปิดที่นี่ด้วย** เพราะ anon key เรียก API สมัครได้โดยตรง
2. ใช้ HTTPS เท่านั้น (Tailscale serve, Cloudflare Tunnel หรือ reverse proxy อย่าง Caddy) — แอปส่ง HSTS ในโหมด production
3. Supabase Auth → URL Configuration: Site URL = URL จริง, Redirect URLs เพิ่ม `<site>/auth/callback`
4. รหัสผ่านอย่างน้อย 12 ตัวอักษร (แอปบังคับ 8) และเปิด "Leaked password protection" ถ้า plan รองรับ
5. env ของแอปมีแค่ `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` ส่วน `SUPABASE_SERVICE_ROLE_KEY` ใช้เฉพาะ worker และ test เท่านั้น ห้ามใส่ใน env ที่ build ฝั่ง client และห้าม commit `.env.local`
6. ตั้งเพดานค่าใช้จ่ายใน ตั้งค่า → การใช้งานและค่าใช้จ่าย ก่อนเชื่อมบริการที่มีค่าใช้จ่าย (TTS/AI API)
7. รัน `npm audit --omit=dev` แล้วตรวจว่าไม่มีช่องโหว่ใน runtime dependencies

## 5. ย้ายไป Supabase cloud (แบบ C/D)

1. สร้างโปรเจกต์ที่ supabase.com (region Singapore ใกล้ไทยที่สุด)
2. `npx supabase link --project-ref <ref>` แล้วรัน `npx supabase db push` เพื่อสร้างตารางจาก migrations
3. ใส่ URL/anon key ของ cloud ใน `.env.local` (แอป) และใส่ service role key ของ cloud (worker)
4. ข้อมูลเดิม: backup จาก local ใช้คำสั่ง `pg_restore` ตามข้อ 7 ได้ แต่ต้องชี้ไปที่ connection string ของ cloud (Project Settings → Database) — `npm run restore` รองรับเฉพาะ Docker local
5. ทำตามเช็กลิสต์ข้อ 4 ให้ครบ แล้วทดสอบด้วยบัญชีที่สองว่ามองไม่เห็นข้อมูลของบัญชีแรก เพราะชุดทดสอบ RLS อัตโนมัติไม่ยอมรันกับ URL ที่ไม่ใช่ local

## 6. Monitoring

- **ตั้งค่า → สถานะระบบ**: worker เปิดอยู่ไหม (heartbeat ทุก 15 วินาที ถ้าไม่มีสัญญาณเกิน 45 วินาทีถือว่าไม่ได้เปิด) คิว render ของคุณ งานล้มเหลวใน 24 ชม. และพื้นที่ดิสก์ที่เหลือ ถ้าเหลือน้อยกว่า 2 GB จะเตือน
- **Video Studio**: ถ้างานรอคิวอยู่แต่ worker ไม่ได้เปิด จะบอกทันทีให้รัน `npm run worker`
- **`GET /api/health`** (ไม่ต้องล็อกอิน ตอบแค่ up/down):
  - `200 {"status":"ok","db":"up","worker":"online"|"offline"}` — แอปและฐานข้อมูลตอบ
  - `503` — ฐานข้อมูลไม่ตอบ
  - `/api/health?worker=required` จะตอบ 503 ด้วยเมื่อ worker ไม่ได้เปิด
  - ใช้กับ uptime monitor ฟรี เช่น UptimeRobot (ต้องเข้าถึง URL จากภายนอกได้) หรือ Uptime Kuma บนเครื่องเดียวกัน
- **Log**: worker พิมพ์ log พร้อมเวลาและรหัสงานลง stdout ถ้ารันด้วย Task Scheduler ให้ redirect ลงไฟล์ เช่น `npm run worker >> logs\worker.log 2>&1` สาเหตุที่ render ล้มเหลวเก็บใน `render_jobs.error_code/error_message` และแสดงในหน้าวิดีโอ

## 7. Backup และ restore

```bash
npm run backup                 # → backups/<วันเวลา>/  db.dump + files/ + manifest.json
npm run backup -- --keep 7     # และลบ backup เก่า เก็บไว้ 7 ชุดล่าสุด
```

- สำรองทุกตารางใน `public` และบัญชีผู้ใช้ (`auth.users`, `auth.identities`) เป็นไฟล์ `pg_dump` แบบ custom รวมถึงไฟล์วิดีโอและไฟล์ในคลังทั้งหมด
- **ทุกครั้งที่สำรอง ระบบจะทดลองกู้คืนลงฐานข้อมูลชั่วคราวก่อน** ถ้ากู้คืนไม่ได้จะถือว่าสำรองล้มเหลวและลบโฟลเดอร์ทิ้ง จำนวนแถวที่กู้ได้บันทึกใน `manifest.json`
- `BACKUP_DIR=D:\backups` ใช้เปลี่ยนที่เก็บ — **ควรเก็บไว้คนละไดรฟ์ หรือ copy ขึ้น cloud drive** เพราะถ้าดิสก์เสีย backup ในโฟลเดอร์โปรเจกต์จะหายไปด้วย
- ตั้งเวลาอัตโนมัติ (Windows): Task Scheduler → Daily → `cmd.exe /c cd /d E:\Project_IS\sales_automation && npm run backup -- --keep 14`
- `backups/` อยู่ใน `.gitignore` ห้าม commit เพราะมีข้อมูลบัญชีและ hash ของรหัสผ่าน

**Restore** ใช้กับฐานข้อมูลที่ยังไม่มีบัญชีเท่านั้น และ migration ต้องเป็นชุดเดียวกับตอนสำรอง ระบบจะตรวจทั้งสองข้อก่อนกู้คืน:

```bash
npm run restore -- backups/20261021-020736
```

กรณีต้องกู้ทับฐานข้อมูล local เดิม เช่นข้อมูลเสีย:
1. `npm run backup` สำรองสภาพปัจจุบันไว้ก่อน แม้ข้อมูลจะเสีย
2. `npm run db:reset` **ลบข้อมูล local ทั้งหมด** แล้วสร้างตารางใหม่จาก migrations
3. `npm run restore -- backups/<ชุดที่ต้องการ>`

การกู้คืนทำใน transaction เดียว ถ้าล้มเหลวกลางทางจะไม่มีข้อมูลค้างครึ่งๆ กลางๆ ไฟล์จะถูก copy กลับโดยไม่ทับไฟล์ที่มีอยู่แล้ว
