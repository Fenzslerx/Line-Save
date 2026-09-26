# นับล้าน (Line-Save)

บอท LINE จดบัญชีจาก**รูปสลิป** — ส่งสลิปเข้าแชท บอทอ่าน (OCR ไทย + rule parser + AI เฉพาะเคสยาก) แล้วบันทึกรายรับ/รายจ่ายให้อัตโนมัติ พร้อมสมุดบัญชี LIFF และหน้า admin แบบเรียลไทม์

รันบน **Cloudflare Workers + D1** — ไม่มีเซิร์ฟเวอร์ต้องดูแล

## โครงสร้าง

```
สลิป → LINE Webhook (worker.ts)
      ├─ ดาวน์โหลดรูป (LINE content API)
      ├─ Typhoon OCR (ไทย, ฟรี)
      ├─ Rule parser — อ่านยอด/วันที่/ทิศทาง/ชื่อคู่กรณี ด้วยกฎ (ไม่ใช้ AI)
      ├─ Gemini — เฉพาะเคสที่ parser อ่านไม่ได้
      ├─ Direction Engine — แยกรายรับ/รายจ่าย (docs/DESIGN_direction.md)
      │    ชื่อตัวเอง → ความจำคู่กรณี → ถ้ากำกวม: ถามปุ่มเดียว ห้ามเขียนผิด
      ├─ กันสลิปซ้ำ (message id + เนื้อหาสลิป)
      └─ บันทึก D1 → ตอบการ์ดใบเสร็จพร้อมปุ่มแก้ทิศทาง

LINE Webhook (ข้อความ) → "สรุป" = สรุปรายเดือน, "ชื่อ X" = ตั้งชื่อเล่น,
                          "ชื่อบัญชี X" / "เลขบัญชี X" = ลงทะเบียนตัวตน (แยกทิศทางแม่นตั้งแต่สลิปแรก)

GET /liff  → สมุดบัญชี SPA (dashboard / รายการ / ตั้งค่า / ลบหลายรายการ)
GET /admin → Observability dashboard (live feed ทุก 4 วิ, เมตริก, alerts)
```

## การตั้งค่า (Secrets บน Workers)

```bash
npx wrangler secret put LINE_CHANNEL_SECRET      # LINE Developers > Basic settings
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN # Messaging API > long-lived token
npx wrangler secret put GEMINI_API_KEY           # aistudio.google.com (เคสสลิปยาก)
npx wrangler secret put TYPHOON_API_KEY          # opentyphoon.ai (OCR ไทย)
npx wrangler secret put TYPHOON_MODEL            # เช่น typhoon-ocr-v1.5 (optional)
npx wrangler secret put LIFF_ID                  # LIFF app id (LINE console)
npx wrangler secret put ADMIN_KEY                # รหัสเข้า /admin
```

Optional: `GEMINI_MODEL` (default gemini-3.6-flash), `GEMINI_THINKING_BUDGET` (0 = ปิด thinking)

## Migrations (D1)

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `migrations/d1_schema.sql` | คอลัมน์ group_id, ตาราง bot_groups/budgets/category_rules/slip_dedup_cache |
| `migrations/002_fix_summary_date_filter.sql` | แก้สรุปเดือน (Supabase ยุคเก่า — Workers ใช้ queries ใหม่แล้ว) |
| `migrations/004_system_events.sql` | ตาราง system_events (observability) |
| `migrations/005_observability.sql` | request_logs, pending_slips, audit_log + คอลัมน์ structured log |
| `migrations/006_contact_names.sql` | ความจำชื่อคู่กรณี v1 (ถูกแทนด้วย 007) |
| `migrations/007_contact_roles.sql` | contact_names v2 — ชื่อเดียวหลายบทบาท (income/expense/self) |

รัน: `npx wrangler d1 execute line-expense-db --remote --file migrations/<file>`

## คำสั่ง

```bash
npm install            # ติดตั้ง + build (tsc)
npm test               # Jest (fake D1 — ไม่ยิง API จริง)
npm run deploy:cf      # npx wrangler deploy
npx wrangler tail      # ดู log สด
```

## เอกสารเพิ่มเติม

- [docs/DESIGN_direction.md](docs/DESIGN_direction.md) — สถาปัตยกรรมแยกรายรับ/รายจ่าย (Trust Ladder 4 ชั้น + วงจรเรียนรู้)
- [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md) — ขั้นตอน deploy ใหม่ตั้งแต่ต้นทีละขั้น
