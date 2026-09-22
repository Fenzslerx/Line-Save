# สรุปขั้นตอน Deploy LINE Expense Bot บน Render (Free) & Supabase (Free)

คู่มือนี้สรุปขั้นตอนแบบทีละขั้นตอนสำหรับการตั้งค่าจริงผ่าน Dashboard

---

## 1. ตั้งค่า Supabase (Free Tier)
1. เข้า [supabase.com](https://supabase.com) ➔ กด **New Project** (เลือก Region เช่น Singapore)
2. เมื่อโปรเจกต์พร้อม ให้ไปที่เมนู **SQL Editor** ด้านซ้าย
3. คัดลอกเนื้อหาทั้งหมดจากไฟล์ [migrations/001_init.sql](migrations/001_init.sql) วางลงในช่อง SQL แล้วกด **Run**
4. ไปที่ **Project Settings** (ไอคอนฟันเฟือง) ➔ **API**
   - คัดลอก **Project URL** (เก็บไว้ใช้เป็น `SUPABASE_URL`)
   - ใต้หัวข้อ *Project API keys* คัดลอกค่า **`service_role` (secret)** (เก็บไว้ใช้เป็น `SUPABASE_SERVICE_KEY`)

> ⚠️ **หมายเหตุสำคัญ**: Supabase Free Tier จะ **Auto-pause (หยุดชั่วคราว)** อัตโนมัติหากไม่มีการใช้งานเกิน 7 วัน หากบอทไม่บันทึกข้อมูล ให้ล็อกอินเข้า Supabase Dashboard แล้วกดปุ่ม **Restore**

---

## 2. ตั้งค่า LINE Developers Console
1. เข้า [developers.line.biz](https://developers.line.biz) ➔ เลือก Channel แบบ **Messaging API**
2. แท็บ **Basic settings**:
   - คัดลอก **Channel secret** (ใช้เป็น `LINE_CHANNEL_SECRET`)
3. แท็บ **Messaging API**:
   - กด Issue ในส่วน **Channel access token (long-lived)** แล้วคัดลอกมา (ใช้เป็น `LINE_CHANNEL_ACCESS_TOKEN`)
   - เลื่อนลงมาที่ **Auto-reply messages** ➔ กด Edit ➔ **ปิด Auto-reply** เพื่อไม่ให้ LINE ส่งข้อความซ้ำซ้อนกับบอท

---

## 3. Deploy บน Render (Free Web Service)
1. Push โค้ดโปรเจกต์นี้ขึ้น GitHub Repository ส่วนตัว
2. เข้า [render.com](https://render.com) ➔ กด **New +** ➔ เลือก **Web Service**
3. เชื่อมต่อ GitHub Repository ที่ push ไว้
4. Render จะอ่านไฟล์ `render.yaml` ให้อัตโนมัติ หรือกรอกข้อมูลดังนี้:
   - **Name**: `line-expense-bot`
   - **Region**: `Singapore` (เพื่อความเร็วในการเชื่อมต่อ)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
   - **Health Check Path**: `/health`
5. ไปที่หัวข้อ **Environment Variables** แล้วเพิ่มตัวแปรต่อไปนี้:
   - `LINE_CHANNEL_SECRET`: (ค่าที่ได้จาก LINE)
   - `LINE_CHANNEL_ACCESS_TOKEN`: (ค่าที่ได้จาก LINE)
   - `SUPABASE_URL`: (ค่าที่ได้จาก Supabase)
   - `SUPABASE_SERVICE_KEY`: (service_role key จาก Supabase)
   - `ANTHROPIC_API_KEY`: (API Key จาก console.anthropic.com)
6. กด **Create Web Service** ➔ รอจนกระทั่งสถานะขึ้น **Live**
7. คัดลอก URL ของ Web Service ที่ Render สร้างให้ (เช่น `https://line-expense-bot.onrender.com`)

---

## 4. เชื่อมต่อ Webhook URL ใน LINE
1. กลับไปที่ **LINE Developers Console** ➔ แท็บ **Messaging API**
2. ที่หัวข้อ **Webhook settings**:
   - กด Edit ใส่ URL: `https://<YOUR_RENDER_URL>/webhook`
   - กดปุ่ม **Verify** (ต้องขึ้นสถานะ Success)
   - เปิดสวิตช์ **Use webhook** เป็น **On**
3. สแกน QR Code เพิ่มเพื่อน LINE Bot เพื่อเริ่มใช้งาน:
   - ส่งรูปสลิป ➔ บอทจะส่ง Flex Message ให้เลือกหมวดหมู่
   - พิมพ์ `"สรุป"` ➔ บอทจะแสดงยอดรวมค่าใช้จ่ายประจำเดือน
   - พิมพ์ `"ชื่อ [ชื่อเล่น]"` ➔ บันทึกชื่อของคุณลงในระบบ
