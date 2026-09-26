/**
 * LIFF single-page app served at GET /liff.
 * Minimal white theme, Thai UI, vanilla JS — no external dependencies.
 * All data comes from /api/liff/*; extra features (calendar heatmap,
 * insights, search/filter) are computed client-side from the same payload.
 */
export function renderLiffPage(liffId: string): string {
  const configScript = `<script>window.LIFF_ID=${JSON.stringify(liffId)};</script>`;

  if (!liffId) {
    return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LineSave</title></head>
<body style="font-family:sans-serif;padding:24px;line-height:1.7">
  <h2>ยังไม่ได้ตั้งค่า LIFF_ID</h2>
  <p>สร้าง LIFF app ใน LINE Developers Console แล้วรัน:<br>
  <code>npx wrangler secret put LIFF_ID</code><br>
  โดยตั้ง Endpoint เป็น <code>https://line-expense-bot.jullajakfield.workers.dev/liff</code></p>
</body></html>`;
  }

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>LineSave — สมุดบัญชีของคุณ</title>
${configScript}
<style>
:root {
  --acc: #06C755; --acc-soft: #E9FBF1; --red: #E5484D; --red-soft: #FDECEC;
  --amber: #F59E0B;
  --bg: #FAFAFB; --card: #FFFFFF; --ink: #16181D; --muted: #9AA0A8; --line: #F0F0F2;
  --chip: #F4F5F6;
}
* { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
body { font-family:-apple-system,'Segoe UI','Noto Sans Thai',sans-serif; background:var(--bg); color:var(--ink); padding-bottom:88px; }
.wrap { max-width:520px; margin:0 auto; padding:14px 16px; }
header { display:flex; align-items:center; gap:11px; padding:14px 2px 12px; }
header img { width:42px; height:42px; border-radius:50%; object-fit:cover; border:2px solid var(--acc-soft); }
.h-name { font-weight:800; font-size:16px; letter-spacing:-.2px; }
.h-sub { color:var(--muted); font-size:12px; margin-top:1px; }
.monthnav { display:flex; align-items:center; justify-content:space-between; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:5px; margin:2px 0 14px; }
.monthnav button { background:var(--chip); border:none; border-radius:10px; width:38px; height:34px; font-size:17px; color:var(--ink); cursor:pointer; }
.monthnav button.allbtn { width:auto; padding:0 12px; font-size:12.5px; font-weight:700; color:var(--muted); }
.monthnav button.allbtn.on { background:var(--ink); color:#fff; }
.monthnav .m-label { font-weight:700; font-size:14px; }
.tabs { display:flex; position:fixed; bottom:0; left:0; right:0; background:#FFFFFF; border-top:1px solid #E3E5E8; box-shadow:0 -2px 12px rgba(16,24,40,.07); z-index:30; padding-bottom:env(safe-area-inset-bottom); }
.tabs button { flex:1; border:none; background:none; padding:9px 0 10px; font-size:11.5px; color:#5F6570; font-weight:600; cursor:pointer; transition:color .15s; }
.tabs button .ico { display:block; margin-bottom:2px; opacity:.8; transition:opacity .15s; }
.tabs button .ico svg { display:block; width:21px; height:21px; margin:0 auto; }
.tabs button.active { color:var(--acc); font-weight:800; }
.tabs button.active .ico { opacity:1; }
.page { display:none; animation:fadein .18s ease; }
.page.active { display:block; }
@keyframes fadein { from{opacity:.4; transform:translateY(3px)} to{opacity:1; transform:none} }
.card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:16px; margin-bottom:12px; box-shadow:0 1px 2px rgba(16,24,40,.03); }
h2.sec { font-size:12px; margin:14px 4px 8px; color:var(--muted); font-weight:700; letter-spacing:.4px; text-transform:uppercase; }
/* hero */
.hero-lbl { color:var(--muted); font-size:12px; }
.hero-v { font-size:34px; font-weight:800; letter-spacing:-.8px; margin:2px 0 12px; }
.hero-split { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.mini { background:var(--bg); border-radius:13px; padding:10px 12px; }
.mini .lbl { color:var(--muted); font-size:11px; margin-bottom:1px; }
.mini .v { font-size:17px; font-weight:750; }
.pos { color:var(--acc); } .neg { color:var(--red); }
/* insights */
.insights { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
.ins { background:var(--card); border:1px solid var(--line); border-radius:15px; padding:12px 13px; }
.ins .lbl { font-size:11px; color:var(--muted); margin-bottom:3px; }
.ins .v { font-size:16px; font-weight:750; }
.ins .d { font-size:11px; color:var(--muted); margin-top:2px; }
/* budget */
.bud-line { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; margin-bottom:7px; }
.bud-line b { font-size:14px; }
.bar-bg { height:8px; background:var(--chip); border-radius:6px; overflow:hidden; }
.bar-fill { height:100%; border-radius:6px; background:var(--acc); transition:width .4s ease; }
.hint { font-size:11.5px; color:var(--muted); margin-top:6px; }
/* calendar heatmap */
.cal { display:grid; grid-template-columns:repeat(7,1fr); gap:5px; }
.cal .dow { font-size:9.5px; color:var(--muted); text-align:center; padding-bottom:2px; }
.cal .day { aspect-ratio:1; border-radius:9px; background:var(--chip); display:flex; align-items:center; justify-content:center; font-size:10.5px; color:var(--muted); cursor:pointer; position:relative; }
.cal .day.spent { color:#fff; font-weight:700; }
.cal .day.today { outline:2px solid var(--acc); outline-offset:-2px; }
.cal .day .tip { position:absolute; bottom:calc(100% + 4px); left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; font-size:10px; padding:3px 7px; border-radius:6px; white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .12s; z-index:5; }
.cal .day:active .tip { opacity:1; }
.cal-legend { display:flex; align-items:center; gap:4px; justify-content:flex-end; margin-top:8px; font-size:10px; color:var(--muted); }
.cal-legend i { width:12px; height:12px; border-radius:4px; display:inline-block; }
/* chart */
.chart { display:flex; align-items:flex-end; gap:6px; height:120px; padding-top:6px; }
.chart .col { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; height:100%; justify-content:flex-end; }
.chart .pair { display:flex; gap:3px; align-items:flex-end; height:100%; width:70%; }
.chart .b { flex:1; border-radius:5px 5px 2px 2px; min-height:3px; transition:height .4s ease; }
.chart .b.inc { background:var(--acc); }
.chart .b.exp { background:#F5B5B7; }
.chart .m { font-size:9.5px; color:var(--muted); }
.legend { display:flex; gap:14px; justify-content:center; margin-top:9px; font-size:11px; color:var(--muted); }
.legend i { display:inline-block; width:9px; height:9px; border-radius:3px; margin-right:4px; }
/* categories */
.bar-row { margin:10px 0; }
.bar-row .top { display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; }
.bar-row .pct { color:var(--muted); font-size:11px; margin-left:5px; }
/* tx list */
.txbar { display:flex; gap:8px; margin-bottom:12px; }
.txbar input { flex:1; border:1px solid var(--line); background:var(--card); border-radius:12px; padding:10px 13px; font-size:14px; color:var(--ink); }
.txbar input::placeholder { color:var(--muted); }
.fseg { display:flex; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:3px; }
.fseg button { border:none; background:none; padding:6px 11px; border-radius:9px; font-size:12.5px; color:var(--muted); cursor:pointer; }
.fseg button.on { background:var(--ink); color:#fff; font-weight:700; }
.daygrp { margin-bottom:14px; }
.dayhdr { display:flex; justify-content:space-between; align-items:baseline; padding:0 2px 7px; gap:6px; }
.dayhdr .dt { font-size:12.5px; font-weight:700; }
.dayhdr .dt span { color:var(--muted); font-weight:400; font-size:11px; margin-left:5px; }
.dayhdr .ds { font-size:12px; color:var(--muted); }
.dayall { border:1.5px solid var(--red); background:transparent; color:var(--red); border-radius:9px; padding:3px 9px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap; }
.dayall.on { background:var(--red); color:#fff; }
.tx { display:flex; align-items:center; gap:12px; padding:11px 4px; border-bottom:1px solid var(--line); cursor:pointer; }
.tx:last-child { border-bottom:none; }
.tx:active { background:var(--bg); }
.tx .ic { width:40px; height:40px; border-radius:13px; display:flex; align-items:center; justify-content:center; font-size:17px; font-weight:700; color:var(--muted); background:var(--chip); flex-shrink:0; }
.tx.inc .ic { background:var(--acc-soft); }
.tx .mid { flex:1; min-width:0; }
.tx .cat { font-weight:650; font-size:14px; }
.tx .sub { color:var(--muted); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px; }
.tx .amt { font-weight:750; font-size:14.5px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.badge { display:inline-block; font-size:9.5px; background:var(--acc-soft); color:var(--acc); border-radius:5px; padding:1.5px 6px; margin-left:6px; font-weight:700; vertical-align:1px; }
.empty { text-align:center; color:var(--muted); padding:26px 0; font-size:13.5px; }
.chipclear { display:inline-flex; align-items:center; gap:6px; background:var(--ink); color:#fff; font-size:12px; border-radius:20px; padding:6px 12px; margin:0 0 10px; cursor:pointer; border:none; }
/* multi-delete mode */
.selrow { display:flex; justify-content:flex-end; margin:0 0 10px; }
.seltool { border:1.5px solid var(--red); background:var(--red-soft); color:var(--red); font-size:12.5px; font-weight:700; border-radius:20px; padding:7px 14px; cursor:pointer; }
.seltool.on { background:var(--red); color:#fff; }
.tx .ck { width:24px; height:24px; border-radius:50%; border:2px solid #C9CDD3; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:13px; color:#fff; }
.tx.picked { background:var(--red-soft); border-radius:12px; }
.tx.picked .ck { background:var(--red); border-color:var(--red); }
.delbar { position:fixed; left:14px; right:14px; bottom:calc(70px + env(safe-area-inset-bottom)); display:flex; gap:10px; z-index:45; }
.delbar .btn-danger, .delbar .btn-ghost { width:auto; margin-top:0; box-shadow:0 6px 18px rgba(16,24,40,.18); }
body.deleting .fab { display:none; }
/* fab + sheet */
.fab { position:fixed; right:18px; bottom:86px; width:54px; height:54px; border-radius:18px; background:var(--ink); color:#fff; font-size:26px; border:none; box-shadow:0 8px 22px rgba(16,24,40,.28); cursor:pointer; z-index:40; }
.overlay { position:fixed; inset:0; background:rgba(16,18,24,.4); display:none; align-items:flex-end; justify-content:center; z-index:50; }
.overlay.show { display:flex; }
.sheet { background:var(--card); width:100%; max-width:520px; border-radius:24px 24px 0 0; padding:20px 18px max(26px, env(safe-area-inset-bottom)); max-height:92vh; overflow:auto; animation:up .22s ease; }
@keyframes up { from{transform:translateY(40px); opacity:.6} to{transform:none; opacity:1} }
.sheet h3 { margin-bottom:14px; font-size:16px; }
.field { margin-bottom:12px; }
.field label { display:block; font-size:11.5px; color:var(--muted); margin-bottom:5px; font-weight:600; }
.field input { width:100%; border:1.5px solid var(--line); border-radius:13px; padding:12px 13px; font-size:15px; background:var(--bg); color:var(--ink); }
.field input:focus { outline:none; border-color:var(--acc); }
.seg { display:flex; background:var(--chip); border-radius:13px; padding:3px; }
.seg button { flex:1; border:none; background:none; padding:9px 0; border-radius:10px; font-size:14px; color:var(--muted); cursor:pointer; }
.seg button.on-inc { background:#fff; color:var(--acc); font-weight:750; box-shadow:0 1px 4px rgba(0,0,0,.07); }
.seg button.on-exp { background:#fff; color:var(--red); font-weight:750; box-shadow:0 1px 4px rgba(0,0,0,.07); }
.chips { display:flex; flex-wrap:wrap; gap:7px; }
.chips button { border:1.5px solid var(--line); background:var(--bg); border-radius:20px; padding:7px 13px; font-size:13px; cursor:pointer; color:var(--ink); }
.chips button.sel { background:var(--ink); border-color:var(--ink); color:#fff; font-weight:650; }
.btn-primary { width:100%; border:none; background:var(--acc); color:#fff; border-radius:14px; padding:14px; font-size:15px; font-weight:750; cursor:pointer; margin-top:6px; }
.btn-primary:active { transform:scale(.985); }
.btn-danger { width:100%; border:none; background:var(--red-soft); color:var(--red); border-radius:14px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:8px; }
.btn-ghost { width:100%; border:1.5px solid var(--line); background:var(--card); color:var(--ink); border-radius:14px; padding:12px; font-size:14px; cursor:pointer; margin-top:8px; }
/* toast + skeleton */
#toast { position:fixed; left:50%; bottom:100px; transform:translate(-50%, 20px); background:var(--ink); color:#fff; font-size:13px; padding:10px 18px; border-radius:24px; opacity:0; pointer-events:none; transition:all .25s; z-index:99; box-shadow:0 6px 20px rgba(0,0,0,.25); }
#toast.show { opacity:1; transform:translate(-50%, 0); }
.sk { border-radius:16px; background:linear-gradient(90deg, var(--chip) 25%, #ECEDEF 50%, var(--chip) 75%); background-size:200% 100%; animation:sh 1.1s infinite; margin-bottom:12px; }
@keyframes sh { from{background-position:200% 0} to{background-position:-200% 0} }
.loading { text-align:center; color:var(--muted); padding:30px 0; font-size:13.5px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img id="avatar" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Crect width='44' height='44' rx='22' fill='%23E9FBF1'/%3E%3C/svg%3E" alt="">
    <div><div class="h-name" id="greet">สมุดบัญชี</div><div class="h-sub" id="greetSub">จัดการเงินใน LINE ของคุณ</div></div>
  </header>

  <div id="skeleton">
    <div class="sk" style="height:150px"></div>
    <div class="sk" style="height:80px"></div>
    <div class="sk" style="height:120px"></div>
  </div>
  <div id="loading" class="loading" style="display:none">กำลังโหลด…</div>
  <div id="loadBar" class="loading" style="display:none">กำลังโหลด…</div>
  <div id="loadErr" style="display:none;text-align:center;padding:30px 16px;color:var(--muted);font-size:13.5px">โหลดข้อมูลไม่สำเร็จ<br><button class="btn-primary" style="width:auto;padding:10px 26px;margin:14px auto 0" onclick="loadDash()">ลองอีกครั้ง</button></div>
  <div id="content" style="display:none">

  <!-- ============ หน้าแรก ============ -->
  <div class="page active" id="page-home">
    <div class="monthnav">
      <button onclick="shiftMonth(-1)">‹</button>
      <span class="m-label"></span>
      <button onclick="shiftMonth(1)">›</button>
      <button class="allbtn" onclick="showAll()">ทั้งหมด</button>
    </div>
    <div class="card">
      <div class="hero-lbl">คงเหลือเดือนนี้ (รายรับ − รายจ่าย)</div>
      <div class="hero-v" id="net"></div>
      <div class="hero-split">
        <div class="mini"><div class="lbl">รายรับ</div><div class="v pos" id="inc"></div></div>
        <div class="mini"><div class="lbl">รายจ่าย</div><div class="v neg" id="exp"></div></div>
      </div>
    </div>
    <div class="card" id="budgetCard" style="display:none">
      <div class="bud-line"><span>งบประจำเดือน</span><b id="budgetAmt"></b></div>
      <div class="bar-bg"><div class="bar-fill" id="budgetBar" style="width:0%"></div></div>
      <div class="hint" id="budgetHint"></div>
    </div>
    <div class="insights" id="insights"></div>
    <h2 class="sec">ปฏิทินการใช้จ่าย</h2>
    <div class="card">
      <div class="cal" id="cal"></div>
      <div class="cal-legend">น้อย <i style="background:#FDECEC"></i><i style="background:#F5B5B7"></i><i style="background:#E5484D"></i> มาก</div>
    </div>
    <h2 class="sec">แนวโน้ม 6 เดือน</h2>
    <div class="card">
      <div class="chart" id="chart"></div>
      <div class="legend"><span><i style="background:var(--acc)"></i>รายรับ</span><span><i style="background:#F5B5B7"></i>รายจ่าย</span></div>
    </div>
    <h2 class="sec">ยอดแยกตามหมวด</h2>
    <div class="card" id="cats"></div>
  </div>

  <!-- ============ รายการ ============ -->
  <div class="page" id="page-tx">
    <div class="monthnav">
      <button onclick="shiftMonth(-1)">‹</button>
      <span class="m-label"></span>
      <button onclick="shiftMonth(1)">›</button>
      <button class="allbtn" onclick="showAll()">ทั้งหมด</button>
    </div>
    <div class="txbar">
      <input id="searchBox" placeholder="ค้นหาหมวด / ร้านค้า" oninput="onSearch(this.value)">
      <div class="fseg" id="fseg">
        <button class="on" data-f="">ทั้งหมด</button>
        <button data-f="expense">จ่าย</button>
        <button data-f="income">รับ</button>
      </div>
    </div>
    <button class="chipclear" id="dateChip" style="display:none" onclick="clearDateFilter()"></button>
    <div class="selrow">
      <button class="seltool" id="delToggle" onclick="toggleDelMode()">ลบหลายรายการ</button>
    </div>
    <div class="hint" id="delHint" style="display:none;margin:-4px 2px 8px">แตะ "เลือกทั้งวัน" ที่หัวกลุ่ม หรือค้นหาแล้วแตะรายการ — จบด้วยปุ่มลบด้านล่าง</div>
    <div id="txList"></div>
  </div>

  <!-- ============ ตั้งค่า ============ -->
  <div class="page" id="page-set">
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:10px">งบประจำเดือน</h3>
      <div class="field"><label>ยอดงบ (บาท) — ตั้ง 0 เพื่อลบ</label>
        <input type="number" id="budgetInput" min="0" placeholder="เช่น 15000"></div>
      <button class="btn-primary" onclick="saveBudget()">บันทึกงบ</button>
    </div>
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:10px">สอนบอทจำหมวด</h3>
      <div class="field"><label>คำสำคัญ เช่น "กาแฟ", "น้ำมัน"</label><input id="ruleKeyword" placeholder="กาแฟ"></div>
      <div class="field"><label>หมวดที่ควรจัด</label><input id="ruleCategory" placeholder="อาหารและเครื่องดื่ม"></div>
      <div class="seg" id="ruleType">
        <button data-t="expense" class="on-exp">รายจ่าย</button>
        <button data-t="income">รายรับ</button>
      </div>
      <button class="btn-primary" onclick="saveRule()">บันทึกกฎ</button>
      <div class="hint">ครั้งหน้าที่พิมพ์คำนี้ตอนเพิ่มรายการ บอทจะเดาหมวดให้เอง</div>
    </div>
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:10px">ส่งออกข้อมูล</h3>
      <button class="btn-ghost" onclick="exportCsv()">ดาวน์โหลด CSV เดือนนี้</button>
    </div>
    <div class="hint" style="text-align:center;margin:16px 0 4px">LineSave · สมุดบัญชีใน LINE ของคุณ</div>
  </div>

  </div><!-- /content -->
</div>

<button class="fab" onclick="openAdd()">+</button>

<div class="delbar" id="delBar" style="display:none">
  <button class="btn-ghost" style="margin-top:0;flex:1;padding:11px 0" onclick="toggleDelMode()">ยกเลิก</button>
  <button class="btn-danger" style="margin-top:0;flex:2;padding:11px 0" onclick="bulkDelete()">ลบที่เลือก (<span id="delCount">0</span>)</button>
</div>

<div class="tabs">
  <button class="active" id="tab-home" onclick="showTab('home')"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg></span>หน้าแรก</button>
  <button id="tab-tx" onclick="showTab('tx')"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>รายการ</button>
  <button id="tab-set" onclick="showTab('set')"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg></span>ตั้งค่า</button>
</div>

<div class="overlay" id="sheetOverlay" onclick="if(event.target===this)closeSheet()">
  <div class="sheet">
    <h3 id="sheetTitle">เพิ่มรายการ</h3>
    <div class="seg" id="txType">
      <button data-t="expense" class="on-exp">รายจ่าย</button>
      <button data-t="income">รายรับ</button>
    </div>
    <div class="field" style="margin-top:12px"><label>จำนวนเงิน (บาท)</label><input type="number" id="fAmount" min="0" step="0.01" placeholder="0.00"></div>
    <div class="field"><label>ร้านค้า / รายละเอียด</label><input id="fMerchant" placeholder="เช่น กาแฟ 7-11" oninput="queueSuggest(this.value)"></div>
    <div class="field"><label>หมวดหมู่</label><div class="chips" id="fCats"></div></div>
    <div class="field"><label>วันที่</label><input type="date" id="fDate"></div>
    <div id="suggestHint" class="hint" style="display:none"></div>
    <button class="btn-primary" id="saveBtn" onclick="saveTx()">บันทึกรายการ</button>
    <button class="btn-danger" id="deleteBtn" style="display:none" onclick="deleteTx()">ลบรายการนี้</button>
    <button class="btn-ghost" onclick="closeSheet()">ปิด</button>
  </div>
</div>
<div id="toast"></div>

<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
const CATEGORIES = ['อาหารและเครื่องดื่ม','การเดินทาง','ของใช้ทั่วไป','บิลและสาธารณูปโภค','อื่นๆ'];
const INCOME_CATS = ['เงินเดือน','ขายของ','รายรับทั่วไป','อื่นๆ'];
const TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_DOW = ['อา','จ','อ','พ','พฤ','ศ','อา'];

const $ = id => document.getElementById(id);
const fmt = n => Number(n||0).toLocaleString('th-TH', {maximumFractionDigits:2});
const localMonth = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
const localDate = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const monthTh = m => m === 'all' ? 'ทั้งหมด' : (() => { const p = m.split('-'); return TH_M[+p[1]-1] + ' ' + (+p[0]+543); })();
const catInitial = c => (c || 'รายการ').trim().charAt(0);

let state = { month: localMonth(new Date()), dash: null, editId: null, type: 'expense', category: 'อื่นๆ', q: '', ft: '', filterDate: '', delMode: false, sel: [] };
let accessToken = '';

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const call = tok => fetch(path, { ...opts, headers: { 'content-type':'application/json', authorization: 'Bearer ' + tok } });
  let res = await call(accessToken);
  if (res.status === 401) {
    // Token may have expired mid-session — refresh once and retry before giving up.
    try { accessToken = liff.getAccessToken(); } catch (e) {}
    if (accessToken) res = await call(accessToken);
  }
  if (res.status === 401) {
    $('content').style.display='none';
    $('loading').style.display='block';
    $('loading').textContent = 'หมดอายุการเข้าสู่ระบบ ปิดแล้วเปิดใหม่อีกครั้ง';
    throw new Error('unauthorized');
  }
  return res;
}

async function main() {
  try { await liff.init({ liffId: window.LIFF_ID }); } catch (e) {
    $('loading').style.display='block'; $('loading').textContent = 'เชื่อมต่อ LINE ไม่สำเร็จ ปิดแล้วเปิดใหม่อีกครั้ง'; return;
  }
  if (!liff.isLoggedIn()) { liff.login(); return; }
  accessToken = liff.getAccessToken();
  // Render cached data instantly, then refresh profile + dashboard in parallel
  showCached();
  liff.getProfile().then(p => {
    if (p.pictureUrl) $('avatar').src = p.pictureUrl;
    $('greet').textContent = 'สวัสดี, ' + (p.displayName || 'เพื่อน');
    $('greetSub').textContent = 'วันนี้ออมได้เท่าไหร่แล้ว?';
    api('/api/liff/me', { method: 'POST', body: JSON.stringify({ name: p.displayName }) }).catch(() => {});
  }).catch(() => {});
  await loadDash();
}

function showCached() {
  try {
    const cached = localStorage.getItem('liffDash:' + state.month);
    if (!cached) return;
    state.dash = JSON.parse(cached);
    $('skeleton').style.display = 'none';
    $('loading').style.display = 'none';
    $('content').style.display = 'block';
    render();
  } catch (e) {}
}

let loadSeq = 0;
async function loadDash() {
  const seq = ++loadSeq;
  $('loadErr').style.display = 'none';
  if (!state.dash) {
    $('skeleton').style.display = 'block';
  } else {
    $('loadBar').style.display = 'block';
  }
  try {
    const r = await api('/api/liff/dashboard?month=' + state.month);
    if (!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    if (seq !== loadSeq) return; // a newer request superseded this one
    state.dash = data;
    try { localStorage.setItem('liffDash:' + state.month, JSON.stringify(data)); } catch (e) {}
    $('skeleton').style.display = 'none';
    $('loadBar').style.display = 'none';
    $('loading').style.display = 'none';
    $('loadErr').style.display = 'none';
    $('content').style.display = 'block';
    render();
  } catch (e) {
    if (seq !== loadSeq || String(e && e.message) === 'unauthorized') return;
    $('skeleton').style.display = 'none';
    $('loadBar').style.display = 'none';
    if (!state.dash) {
      // No live data and no cache — show a retry screen instead of a blank page.
      showCached();
    }
    if (!state.dash) {
      $('content').style.display = 'none';
      $('loadErr').style.display = 'block';
    } else {
      toast('โหลดข้อมูลไม่สำเร็จ แสดงข้อมูลเดิมไว้ก่อน');
    }
  }
}

function monthInfo() {
  if (state.month === 'all') {
    return { isAll: true, y: 0, m: 0, dim: 0, isCur: false, today: 0, elapsed: 0, left: 0 };
  }
  const now = new Date();
  const p = state.month.split('-').map(Number);
  const dim = new Date(p[0], p[1], 0).getDate();
  const isCur = state.month === localMonth(now);
  return { isAll: false, y: p[0], m: p[1], dim, isCur, today: now.getDate(), elapsed: isCur ? now.getDate() : dim, left: isCur ? Math.max(1, dim - now.getDate() + 1) : 0 };
}

function render() {
  const d = state.dash, mi = monthInfo();
  document.querySelectorAll('.m-label').forEach(el => el.textContent = monthTh(state.month));
  document.querySelectorAll('.allbtn').forEach(b => b.classList.toggle('on', state.month === 'all'));
  const net = d.totals.income - d.totals.expense;
  const netEl = $('net');
  netEl.textContent = (net >= 0 ? '+฿' : '−฿') + fmt(Math.abs(net));
  netEl.className = 'hero-v ' + (net >= 0 ? 'pos' : 'neg');
  $('inc').textContent = '+฿' + fmt(d.totals.income);
  $('exp').textContent = '−฿' + fmt(d.totals.expense);

  /* budget */
  const bc = $('budgetCard');
  if (!mi.isAll && d.budget && d.budget > 0) {
    bc.style.display = 'block';
    const pct = Math.min(100, d.totals.expense / d.budget * 100);
    $('budgetAmt').textContent = '฿' + fmt(d.totals.expense) + ' / ฿' + fmt(d.budget);
    const bar = $('budgetBar');
    bar.style.width = pct + '%';
    bar.style.background = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--acc)';
    let hint = 'ใช้ไปแล้ว ' + Math.round(pct) + '% ของงบ';
    if (pct >= 100) hint = 'งบเกินแล้ว ' + fmt(d.totals.expense - d.budget) + ' บาท';
    else if (mi.isCur) hint += ' · เหลือวันละ ~฿' + fmt((d.budget - d.totals.expense) / mi.left);
    $('budgetHint').textContent = hint;
    $('budgetInput').value = d.budget;
  } else bc.style.display = 'none';

  /* insights */
  const avgDay = d.totals.expense / (mi.elapsed || 1);
  const saveRate = d.totals.income > 0 ? Math.round((d.totals.income - d.totals.expense) / d.totals.income * 100) : null;
  const expCats = d.categories.filter(c => c.type === 'expense');
  const top = expCats[0];
  let html;
  if (mi.isAll) {
    // All-time view: skip daily-average / forecast cards, show savings rate only
    html = '<div class="ins" style="grid-column:1 / -1"><div class="lbl">อัตราการออม (รวมทุกเดือน)</div><div class="v">' +
      (saveRate === null ? '—' : saveRate + '%') + '</div><div class="d">' +
      (saveRate === null ? 'ยังไม่มีรายรับ' : (saveRate >= 0 ? 'ออมได้ ' + saveRate + '%' : 'ใช้เกินรายรับ')) + '</div></div>';
    if (top) html += '<div class="ins" style="grid-column:1 / -1"><div class="lbl">ใช้มากที่สุด</div><div class="v">' + esc(top.category) + ' · ฿' + fmt(top.total) + '</div><div class="d">' + Math.round(top.total / (d.totals.expense||1) * 100) + '% ของรายจ่ายทั้งหมด</div></div>';
  } else {
    html =
      '<div class="ins"><div class="lbl">เฉลี่ยต่อวัน</div><div class="v">฿' + fmt(avgDay) + '</div><div class="d">' + (mi.isCur ? 'คิดจาก ' + mi.elapsed + ' วันที่ผ่านมา' : 'ทั้งเดือน') + '</div></div>' +
      '<div class="ins"><div class="lbl">' + (mi.isCur ? 'คาดการณ์สิ้นเดือน' : 'อัตราการออม') + '</div><div class="v">' +
      (mi.isCur ? '฿' + fmt(avgDay * mi.dim) : (saveRate === null ? '—' : saveRate + '%')) + '</div><div class="d">' +
      (mi.isCur ? 'ถ้าใช้ต่อแบบนี้' : (saveRate === null ? 'ยังไม่มีรายรับเดือนนี้' : (saveRate >= 0 ? 'ออมได้ ' + saveRate + '%' : 'ใช้เกินรายรับ'))) + '</div></div>';
    if (top) html += '<div class="ins" style="grid-column:1 / -1"><div class="lbl">ใช้มากที่สุด</div><div class="v">' + esc(top.category) + ' · ฿' + fmt(top.total) + '</div><div class="d">' + Math.round(top.total / (d.totals.expense||1) * 100) + '% ของรายจ่ายทั้งหมด</div></div>';
  }
  $('insights').innerHTML = html;
  // Calendar only makes sense for a single month
  $('insights').style.display = 'grid';
  if (mi.isAll) $('cal').innerHTML = '';
  else renderCal(mi);
  document.querySelectorAll('h2.sec').forEach(h => { if (h.textContent.indexOf('ปฏิทิน') > -1) h.style.display = mi.isAll ? 'none' : 'block'; });

  /* trend chart */
  const maxV = Math.max(1, ...d.trend.map(t => Math.max(t.income, t.expense)));
  $('chart').innerHTML = d.trend.length === 0 ? '<div class="empty" style="width:100%">ยังไม่มีข้อมูล</div>' :
    d.trend.map(t =>
      '<div class="col"><div class="pair">' +
      '<div class="b inc" style="height:' + Math.max(3, Math.round(t.income / maxV * 100)) + '%"></div>' +
      '<div class="b exp" style="height:' + Math.max(3, Math.round(t.expense / maxV * 100)) + '%"></div></div>' +
      '<div class="m">' + monthTh(t.month).split(' ')[0] + '</div></div>').join('');

  /* categories */
  const catEl = $('cats');
  if (!d.categories.length) catEl.innerHTML = '<div class="empty">ยังไม่มีรายการในเดือนนี้</div>';
  else {
    const maxC = Math.max(...d.categories.map(c => c.total));
    catEl.innerHTML = d.categories.map(c => {
      const share = Math.round(c.total / maxC * 100);
      return '<div class="bar-row"><div class="top"><span>' + esc(c.category) + '<span class="pct">' + (c.type==='income'?'รายรับ':'') + '</span></span><span class="' + (c.type==='income'?'pos':'neg') + '">฿' + fmt(c.total) + '</span></div>' +
        '<div class="bar-bg"><div class="bar-fill" style="width:' + share + '%; background:' + (c.type==='expense' ? '#F5B5B7' : 'var(--acc)') + '"></div></div></div>';
    }).join('');
  }

  renderTx();
}

function renderCal(mi) {
  const d = state.dash;
  const daily = {};
  d.transactions.filter(t => t.type === 'expense').forEach(t => { daily[t.date] = (daily[t.date] || 0) + t.amount; });
  const maxD = Math.max(1, ...Object.values(daily));
  const first = new Date(mi.y, mi.m - 1, 1).getDay();
  let html = ['จ','อ','พ','พฤ','ศ','อ','อา'].map(w => '<div class="dow">' + w + '</div>').join('');
  for (let i = 0; i < first; i++) html += '<div></div>';
  for (let day = 1; day <= mi.dim; day++) {
    const ds = state.month + '-' + String(day).padStart(2,'0');
    const amt = daily[ds];
    let style = '', cls = 'day';
    if (amt) {
      cls += ' spent';
      style = ' style="background:rgba(229,72,77,' + (0.25 + 0.75 * Math.sqrt(amt / maxD)).toFixed(2) + ')"';
    }
    if (mi.isCur && day === mi.today) cls += ' today';
    html += '<div class="' + cls + '"' + style + ' onclick="dayFilter(\\'' + ds + '\\')">' + day +
      (amt ? '<div class="tip">฿' + fmt(amt) + '</div>' : '') + '</div>';
  }
  $('cal').innerHTML = html;
}

function dayFilter(ds) { state.filterDate = ds; showTab('tx'); renderTx(); }
function clearDateFilter() { state.filterDate = ''; renderTx(); }

function onSearch(v) { state.q = v.trim(); renderTx(); }

function renderTx() {
  const list = state.dash.transactions.filter(t =>
    (!state.ft || t.type === state.ft) &&
    (!state.filterDate || t.date === state.filterDate) &&
    (!state.q || (t.category + ' ' + (t.merchant || '')).indexOf(state.q) > -1));

  const chip = $('dateChip');
  if (state.filterDate) {
    const dt = new Date(state.filterDate + 'T00:00:00');
    chip.style.display = 'inline-flex';
    chip.textContent = dt.getDate() + ' ' + TH_M[dt.getMonth()] + ' · แตะเพื่อล้าง';
  } else chip.style.display = 'none';

  const el = $('txList');
  if (!list.length) { el.innerHTML = '<div class="empty">' + (state.q || state.filterDate || state.ft ? 'ไม่พบรายการที่ตรงเงื่อนไข' : 'ไม่มีรายการ — กดปุ่ม + เพื่อเพิ่ม') + '</div>'; return; }

  const groups = {};
  list.forEach(t => { (groups[t.date] = groups[t.date] || []).push(t); });
  el.innerHTML = Object.keys(groups).sort().reverse().map(date => {
    const rows = groups[date];
    const dayTot = rows.reduce((s, t) => s + (t.type === 'expense' ? t.amount : 0), 0);
    const dt = new Date(date + 'T00:00:00');
    const dayPicked = state.delMode && rows.every(t => state.sel.indexOf(t.id) > -1) && rows.length > 0;
    return '<div class="daygrp card"><div class="dayhdr"><div class="dt">' + dt.getDate() + ' ' + TH_M[dt.getMonth()] + ' ' + (dt.getFullYear()+543) + '<span>วัน' + ['', 'จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'][dt.getDay()] + '</span></div>' +
      (dayTot > 0 ? '<div class="ds">จ่าย ฿' + fmt(dayTot) + '</div>' : '') +
      (state.delMode ? '<button class="dayall' + (dayPicked ? ' on' : '') + '" onclick="toggleDaySel(\\'' + date + '\\')">' + (dayPicked ? '✓ เลือกแล้ว' : 'เลือกทั้งวัน') + '</button>' : '') +
      '</div>' +
      rows.map(txRow).join('') + '</div>';
  }).join('');
}

/** Select/deselect every visible transaction of one day — fast cleanup for old slips. */
function toggleDaySel(date) {
  const ids = state.dash.transactions
    .filter(t => t.date === date &&
      (!state.ft || t.type === state.ft) &&
      (!state.filterDate || t.date === state.filterDate) &&
      (!state.q || (t.category + ' ' + (t.merchant || '')).indexOf(state.q) > -1))
    .map(t => t.id);
  const allSel = ids.length > 0 && ids.every(id => state.sel.indexOf(id) > -1);
  ids.forEach(id => {
    const i = state.sel.indexOf(id);
    if (allSel) { if (i > -1) state.sel.splice(i, 1); }
    else if (i < 0) state.sel.push(id);
  });
  updateDelCount();
  renderTx();
}

function txRow(t) {
  const picked = state.delMode && state.sel.indexOf(t.id) > -1;
  const ck = state.delMode ? '<div class="ck">' + (picked ? '✓' : '') + '</div>' : '';
  return '<div class="tx ' + (t.type === 'income' ? 'inc' : 'exp') + (picked ? ' picked' : '') + '" onclick="' + (state.delMode ? 'toggleSel(\\'' + t.id + '\\')' : 'openEdit(\\'' + t.id + '\\')') + '">' + ck +
    '<div class="ic">' + esc(catInitial(t.category)) + '</div>' +
    '<div class="mid"><div class="cat">' + esc(t.category) + (t.source !== 'liff' ? '<span class="badge">สลิป</span>' : '') + '</div>' +
    '<div class="sub">' + (t.merchant ? esc(t.merchant) : 'ไม่ระบุร้านค้า') + '</div></div>' +
    '<div class="amt ' + (t.type === 'income' ? 'pos' : 'neg') + '">' + (t.type === 'income' ? '+' : '−') + '฿' + fmt(t.amount) + '</div></div>';
}

function toggleDelMode() {
  state.delMode = !state.delMode;
  state.sel = [];
  document.body.classList.toggle('deleting', state.delMode);
  $('delToggle').textContent = state.delMode ? 'ออกจากโหมดลบ' : 'ลบหลายรายการ';
  $('delToggle').classList.toggle('on', state.delMode);
  $('delBar').style.display = state.delMode ? 'flex' : 'none';
  $('delHint').style.display = state.delMode ? 'block' : 'none';
  updateDelCount();
  renderTx();
}
function toggleSel(id) {
  const i = state.sel.indexOf(id);
  if (i > -1) state.sel.splice(i, 1); else state.sel.push(id);
  updateDelCount();
  renderTx();
}
function updateDelCount() { $('delCount').textContent = state.sel.length; }
async function bulkDelete() {
  if (!state.sel.length) { toast('ยังไม่ได้เลือกรายการ'); return; }
  if (!confirm('ลบ ' + state.sel.length + ' รายการที่เลือก?')) return;
  const btn = event && event.target;
  if (btn) btn.disabled = true;
  try {
    await api('/api/liff/transactions/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: state.sel }) });
    toast('ลบ ' + state.sel.length + ' รายการแล้ว');
    state.delMode = false; state.sel = [];
    document.body.classList.remove('deleting');
    $('delToggle').textContent = 'ลบหลายรายการ';
    $('delToggle').classList.remove('on');
    $('delBar').style.display = 'none';
    await loadDash();
  } catch (e) {
    if (String(e && e.message) !== 'unauthorized') toast('ลบไม่สำเร็จ ลองอีกครั้ง');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showTab(t) {
  ['home','tx','set'].forEach(k => {
    $('page-' + k).classList.toggle('active', k === t);
    $('tab-' + k).classList.toggle('active', k === t);
  });
  if (t !== 'tx' && state.delMode) toggleDelMode();
}
function shiftMonth(d) {
  if (state.month === 'all') {
    // Leaving the all-time view — start from the current month
    state.month = localMonth(new Date());
  } else {
    const p = state.month.split('-').map(Number);
    const nd = new Date(p[0], p[1] - 1 + d, 1);
    state.month = nd.getFullYear() + '-' + String(nd.getMonth()+1).padStart(2,'0');
  }
  document.querySelectorAll('.m-label').forEach(el => el.textContent = monthTh(state.month));
  document.querySelectorAll('.allbtn').forEach(b => b.classList.toggle('on', state.month === 'all'));
  if (state.delMode) toggleDelMode();
  showCached();
  loadDash();
}
function showAll() {
  if (state.month === 'all') return;
  state.month = 'all';
  document.querySelectorAll('.m-label').forEach(el => el.textContent = 'ทั้งหมด');
  document.querySelectorAll('.allbtn').forEach(b => b.classList.add('on'));
  if (state.delMode) toggleDelMode();
  showCached();
  loadDash();
}

/* ---- add / edit sheet ---- */
function openAdd() {
  state.editId = null; state.type = 'expense';
  $('sheetTitle').textContent = 'เพิ่มรายการ';
  $('deleteBtn').style.display = 'none';
  $('fAmount').value = '';
  $('fMerchant').value = '';
  $('fDate').value = localDate(new Date());
  $('suggestHint').style.display = 'none';
  setType('expense');
  $('sheetOverlay').classList.add('show');
}
function openEdit(id) {
  const t = state.dash.transactions.find(x => x.id === id);
  if (!t) return;
  state.editId = id; state.type = t.type;
  $('sheetTitle').textContent = 'แก้ไขรายการ';
  $('deleteBtn').style.display = 'block';
  $('fAmount').value = t.amount;
  $('fMerchant').value = t.merchant || '';
  $('fDate').value = t.date;
  $('suggestHint').style.display = 'none';
  setType(t.type); state.category = t.category; renderCats();
  $('sheetOverlay').classList.add('show');
}
function closeSheet() { $('sheetOverlay').classList.remove('show'); }
function setType(t) {
  state.type = t;
  document.querySelectorAll('#txType button').forEach(b => {
    b.className = b.dataset.t === t ? (t === 'income' ? 'on-inc' : 'on-exp') : '';
  });
  renderCats();
}
document.querySelectorAll('#txType button').forEach(b => b.onclick = () => setType(b.dataset.t));
document.querySelectorAll('#fseg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#fseg button').forEach(x => x.className = '');
  b.className = 'on';
  state.ft = b.dataset.f;
  renderTx();
});
let ruleType = 'expense';
document.querySelectorAll('#ruleType button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#ruleType button').forEach(x => x.className = '');
  b.className = b.dataset.t === 'income' ? 'on-inc' : 'on-exp';
  ruleType = b.dataset.t;
});
function renderCats() {
  const cats = state.type === 'income' ? INCOME_CATS : CATEGORIES;
  if (!cats.includes(state.category)) state.category = cats[cats.length - 1];
  $('fCats').innerHTML = cats.map(c =>
    '<button class="' + (c === state.category ? 'sel' : '') + '" onclick="pickCat(\\'' + esc(c) + '\\')">' + esc(c) + '</button>').join('');
}
function pickCat(c) { state.category = c; renderCats(); }

let suggestSeq = 0, suggestTimer = null;
function queueSuggest(v) {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => suggestCat(v), 350);
}
async function suggestCat(kw) {
  if (!kw || kw.length < 2) { $('suggestHint').style.display = 'none'; return; }
  const seq = ++suggestSeq;
  try {
    const r = await api('/api/liff/suggest-category', { method: 'POST', body: JSON.stringify({ keyword: kw }) });
    if (seq !== suggestSeq) return; // user kept typing — ignore stale response
    const j = await r.json();
    const hint = $('suggestHint');
    if (j.rule) {
      hint.style.display = 'block';
      hint.textContent = 'จากที่คุณสอนไว้: "' + kw + '" → ' + j.rule.category;
      state.type = j.rule.type; setType(j.rule.type); state.category = j.rule.category; renderCats();
    } else hint.style.display = 'none';
  } catch (e) {}
}

async function saveTx() {
  const amount = parseFloat($('fAmount').value);
  if (!amount || amount <= 0) { toast('กรอกจำนวนเงินก่อนนะ'); return; }
  const payload = {
    amount, type: state.type, category: state.category,
    merchant: $('fMerchant').value || null,
    date: $('fDate').value
  };
  const btn = $('saveBtn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    if (state.editId) {
      await api('/api/liff/transactions/' + state.editId, { method: 'PUT', body: JSON.stringify(payload) });
      toast('แก้ไขเรียบร้อย');
    } else {
      await api('/api/liff/transactions', { method: 'POST', body: JSON.stringify(payload) });
      toast('บันทึกเรียบร้อย');
    }
    closeSheet();
    await loadDash();
    showTab('tx');
  } catch (e) {
    if (String(e && e.message) !== 'unauthorized') toast('บันทึกไม่สำเร็จ ลองอีกครั้ง');
  } finally {
    btn.disabled = false; btn.textContent = 'บันทึกรายการ';
  }
}
async function deleteTx() {
  if (!state.editId || !confirm('ลบรายการนี้?')) return;
  const btn = $('deleteBtn');
  btn.disabled = true;
  try {
    await api('/api/liff/transactions/' + state.editId, { method: 'DELETE' });
    toast('ลบรายการแล้ว');
    closeSheet();
    await loadDash();
  } catch (e) {
    if (String(e && e.message) !== 'unauthorized') toast('ลบไม่สำเร็จ ลองอีกครั้ง');
  } finally {
    btn.disabled = false;
  }
}
async function saveBudget() {
  const v = parseFloat($('budgetInput').value || '0');
  const btn = event && event.target;
  if (btn) btn.disabled = true;
  try {
    await api('/api/liff/budget', { method:'POST', body: JSON.stringify({ monthly_budget: v }) });
    toast('บันทึกงบเรียบร้อย');
    await loadDash();
  } catch (e) {
    if (String(e && e.message) !== 'unauthorized') toast('บันทึกงบไม่สำเร็จ');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function saveRule() {
  const kw = $('ruleKeyword').value.trim();
  const cat = $('ruleCategory').value.trim();
  if (!kw || !cat) { toast('กรอกคำสำคัญและหมวดก่อนนะ'); return; }
  const btn = event && event.target;
  if (btn) btn.disabled = true;
  try {
    await api('/api/liff/category-rules', { method:'POST', body: JSON.stringify({ keyword: kw, category: cat, type: ruleType }) });
    toast('สอนบอทแล้ว');
    $('ruleKeyword').value = '';
    $('ruleCategory').value = '';
  } catch (e) {
    if (String(e && e.message) !== 'unauthorized') toast('บันทึกกฎไม่สำเร็จ');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function exportCsv() {
  if (state.month === 'all') { toast('เลือกเดือนก่อนส่งออกนะ'); return; }
  const btn = event && event.target;
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/liff/export?month=' + state.month);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transactions-' + state.month + '.csv';
    a.click();
    toast('กำลังดาวน์โหลด CSV');
  } catch (e) {
    toast('ดาวน์โหลดไม่สำเร็จ ลองอีกครั้ง');
  } finally {
    if (btn) btn.disabled = false;
  }
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
main();
</script>
</body>
</html>`;
}
