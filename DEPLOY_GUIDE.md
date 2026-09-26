# Deploy นับล้าน (Line-Save) บน Cloudflare Workers — ทีละขั้น

> ระบบทั้งหมดรันบน Cloudflare Workers + D1 (ไม่มีเซิร์ฟเวอร์) + LINE Messaging API

---

## 1. ติดตั้งและเชื่อม Cloudflare

```bash
npm install
npx wrangler login          # เปิด browser ล็อกอิน Cloudflare
```

สร้างฐานข้อมูล D1 (ครั้งแรกเท่านั้น) — แก้ `database_id` ใน `wrangler.jsonc` ให้ตรงกับที่ได้:

```bash
npx wrangler d1 create line-expense-db
```

## 2. รัน Migrations

```bash
npx wrangler d1 execute line-expense-db --remote --file migrations/d1_schema.sql
npx wrangler d1 execute line-expense-db --remote --file migrations/002_fix_summary_date_filter.sql
npx wrangler d1 execute line-expense-db --remote --file migrations/004_system_events.sql
npx wrangler d1 execute line-expense-db --remote --file migrations/005_observability.sql
npx wrangler d1 execute line-expense-db --remote --file migrations/006_contact_names.sql
npx wrangler d1 execute line-expense-db --remote --file migrations/007_contact_roles.sql
```

> 006/007 สลับกันได้ 007 จะยกข้อมูล 006 มาด้วย · ถ้าขึ้น `duplicate column` แปลว่าใส่ไปแล้ว ข้ามได้

## 3. ตั้ง Secrets

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TYPHOON_API_KEY
npx wrangler secret put TYPHOON_MODEL      # typhoon-ocr-v1.5
npx wrangler secret put LIFF_ID
npx wrangler secret put ADMIN_KEY          # ตั้งรหัสยาว 10+ ตัวอักษร
```

## 4. LINE Developers Console

1. สร้าง Channel แบบ **Messaging API**
2. **Basic settings** → คัดลอก **Channel secret** (ขั้น 3)
3. **Messaging API** → Issue **Channel access token (long-lived)** (ขั้น 3)
4. ปิด **Auto-reply messages** (แก้ไข → OFF) และเปิด **Use webhook**
5. (สมุดบัญชี LIFF) แท็บ LIFF → สร้าง LIFF app:
   - Endpoint: `https://<ชื่อ-worker>.workers.dev/liff`
   - Scope: `profile` + `chat_message.write` · Type: Full
   - คัดลอก LIFF ID (ขั้น 3)
6. **Webhook settings** → URL: `https://<ชื่อ-worker>.workers.dev/webhook` → กด **Verify** ให้ Success

## 5. Deploy

```bash
npm run deploy:cf
# https://line-expense-bot.<subdomain>.workers.dev
curl https://line-expense-bot.<subdomain>.workers.dev/health   # {"status":"ok"}
```

## 6. ตรวจสอบหลัง deploy

- ส่งสลิปเข้าแชท → ได้การ์ดใบเสร็จภายใน ~3-6 วินาที
- `/admin` → ใส่ ADMIN_KEY → หน้า Live ต้องขึ้นกิจกรรมภายใน ~4 วินาที
- ดู log สด: `npx wrangler tail`

## ทราบดีเสมอ

- **โควตา Gemini ฟรี** นับต่อวัน — สลิปส่วนใหญ่อ่านด้วย Typhoon OCR + rule parser (ไม่ใช้ AI) แต่ถ้าโควตาหมดแล้วสลิปยากจะอ่านไม่ได้: เปิด billing ที่ Google AI Studio เพื่อแก้ถาวร (admin จะมี alert เตือนเมื่อโควตาหมด)
- Typhoon OCR ฟรีมี rate limit ต่อช่วงเวลา — ระบบ retry/backoff ให้แล้ว ส่งหลายใบพร้อมกันอาจช้าขึ้นเล็กน้อย
- LIFF ครั้งแรกเข้าช้าเล็กน้อยครั้งเดียว (cold start), ครั้งถัดไปแสดงจาก cache ทันที
