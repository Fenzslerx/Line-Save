/**
 * LIFF single-page app served at GET /liff.
 * Light (white) theme, Thai UI, vanilla JS — no external dependencies.
 * The LIFF ID is injected server-side; empty ID renders a setup notice.
 */
export function renderLiffPage(liffId: string): string {
  const configScript = `<script>window.LIFF_ID=${JSON.stringify(liffId)};</script>`;

  if (!liffId) {
    return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LineSave</title></head>
<body style="font-family:sans-serif;padding:24px;line-height:1.7">
  <h2>⚙️ ยังไม่ได้ตั้งค่า LIFF_ID</h2>
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
<title>LineSave — สรุปรายรับรายจ่าย</title>
${configScript}
<style>
:root {
  --green: #06C755; --green-dark: #049a43; --red: #EF4444; --blue: #3B82F6;
  --bg: #F8FAF9; --card: #FFFFFF; --text: #1A2B22; --muted: #7A8C82; --border: #E6EDE9;
}
* { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
body { font-family:-apple-system,'Segoe UI',Noto Sans Thai,sans-serif; background:var(--bg); color:var(--text); padding-bottom:76px; }
.wrap { max-width:520px; margin:0 auto; padding:16px; }
header { display:flex; align-items:center; gap:10px; padding:18px 2px 10px; }
header img { width:44px; height:44px; border-radius:50%; border:2px solid var(--green); }
header .h-name { font-weight:700; font-size:16px; }
header .h-sub { color:var(--muted); font-size:12px; }
.monthnav { display:flex; align-items:center; justify-content:space-between; margin:6px 0 12px; }
.monthnav button { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:6px 14px; font-size:16px; color:var(--text); cursor:pointer; }
.monthnav .m-label { font-weight:700; font-size:15px; }
.tabs { display:flex; position:fixed; bottom:0; left:0; right:0; background:var(--card); border-top:1px solid var(--border); z-index:30; }
.tabs button { flex:1; border:none; background:none; padding:11px 0 13px; font-size:12px; color:var(--muted); cursor:pointer; }
.tabs button .ico { display:block; font-size:20px; margin-bottom:2px; }
.tabs button.active { color:var(--green-dark); font-weight:700; }
.page { display:none; }
.page.active { display:block; }
.card { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:16px; margin-bottom:12px; }
.totals { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.t-big { grid-column:1 / -1; text-align:center; padding:6px 0 2px; }
.t-big .v { font-size:30px; font-weight:800; }
.t-small .lbl { color:var(--muted); font-size:12px; margin-bottom:2px; }
.t-small .v { font-size:19px; font-weight:700; }
.pos { color:var(--green-dark); } .neg { color:var(--red); }
.bar-row { margin:9px 0; }
.bar-row .top { display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; }
.bar-row .top .amt { font-weight:600; }
.bar-bg { height:8px; background:#EEF3F0; border-radius:6px; overflow:hidden; }
.bar-fill { height:100%; border-radius:6px; background:var(--green); }
.bar-fill.exp { background:var(--red); }
.chart { display:flex; align-items:flex-end; gap:8px; height:110px; padding-top:8px; }
.chart .col { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; height:100%; justify-content:flex-end; }
.chart .stack { width:60%; display:flex; flex-direction:column-reverse; border-radius:6px; overflow:hidden; }
.chart .s-inc { background:var(--green); }
.chart .s-exp { background:#FCA5A5; }
.chart .m { font-size:10px; color:var(--muted); }
.budget-line { display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px; }
.empty { text-align:center; color:var(--muted); padding:26px 0; font-size:14px; }
.tx { display:flex; align-items:center; gap:12px; padding:12px 4px; border-bottom:1px solid var(--border); }
.tx:last-child { border-bottom:none; }
.tx .ic { width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px; background:#F0F5F2; flex-shrink:0; }
.tx.exp .ic { background:#FEF2F2; }
.tx .mid { flex:1; min-width:0; }
.tx .cat { font-weight:600; font-size:14px; }
.tx .sub { color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tx .amt { font-weight:700; font-size:15px; white-space:nowrap; }
.fab { position:fixed; right:18px; bottom:84px; width:56px; height:56px; border-radius:50%; background:var(--green); color:#fff; font-size:28px; border:none; box-shadow:0 6px 18px rgba(6,199,85,.35); cursor:pointer; z-index:40; }
.overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); display:none; align-items:flex-end; justify-content:center; z-index:50; }
.overlay.show { display:flex; }
.sheet { background:var(--card); width:100%; max-width:520px; border-radius:20px 20px 0 0; padding:20px 18px 26px; max-height:92vh; overflow:auto; }
.sheet h3 { margin-bottom:14px; font-size:16px; }
.field { margin-bottom:12px; }
.field label { display:block; font-size:12px; color:var(--muted); margin-bottom:5px; }
.field input { width:100%; border:1px solid var(--border); border-radius:10px; padding:11px 12px; font-size:15px; background:var(--bg); color:var(--text); }
.seg { display:flex; background:#EEF3F0; border-radius:10px; padding:3px; }
.seg button { flex:1; border:none; background:none; padding:9px 0; border-radius:8px; font-size:14px; color:var(--muted); cursor:pointer; }
.seg button.on-inc { background:#fff; color:var(--green-dark); font-weight:700; box-shadow:0 1px 4px rgba(0,0,0,.08); }
.seg button.on-exp { background:#fff; color:var(--red); font-weight:700; box-shadow:0 1px 4px rgba(0,0,0,.08); }
.chips { display:flex; flex-wrap:wrap; gap:7px; }
.chips button { border:1px solid var(--border); background:var(--bg); border-radius:20px; padding:7px 13px; font-size:13px; cursor:pointer; color:var(--text); }
.chips button.sel { background:var(--green); border-color:var(--green); color:#fff; }
.btn-primary { width:100%; border:none; background:var(--green); color:#fff; border-radius:12px; padding:13px; font-size:15px; font-weight:700; cursor:pointer; margin-top:6px; }
.btn-danger { width:100%; border:none; background:#FEF2F2; color:var(--red); border-radius:12px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:8px; }
.btn-ghost { width:100%; border:1px solid var(--border); background:var(--card); color:var(--text); border-radius:12px; padding:12px; font-size:14px; cursor:pointer; margin-top:8px; }
.hint { font-size:12px; color:var(--muted); margin-top:6px; }
.badge { display:inline-block; font-size:10px; background:#F0F5F2; color:var(--muted); border-radius:6px; padding:2px 6px; margin-left:6px; }
.loading { text-align:center; color:var(--muted); padding:30px 0; }
h2.sec { font-size:14px; margin:4px 2px 10px; color:var(--muted); font-weight:600; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img id="avatar" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Crect width='44' height='44' rx='22' fill='%2306C755'/%3E%3C/svg%3E" alt="">
    <div><div class="h-name" id="greet">LineSave 💸</div><div class="h-sub" id="greetSub">จัดการเงินใน LINE ของคุณ</div></div>
  </header>

  <div id="loading" class="loading">กำลังโหลด…</div>

  <!-- ============ หน้าแรก ============ -->
  <div class="page" id="page-home">
    <div class="monthnav">
      <button onclick="shiftMonth(-1)">‹</button>
      <span class="m-label" id="monthLabel"></span>
      <button onclick="shiftMonth(1)">›</button>
    </div>
    <div class="card totals">
      <div class="t-big"><div class="lbl" style="color:var(--muted);font-size:12px">ยอดคงเหลือ (รายรับ − รายจ่าย)</div><div class="v" id="net"></div></div>
      <div class="t-small"><div class="lbl">💰 รายรับ</div><div class="v pos" id="inc"></div></div>
      <div class="t-small"><div class="lbl">💸 รายจ่าย</div><div class="v neg" id="exp"></div></div>
    </div>
    <div class="card" id="budgetCard" style="display:none">
      <div class="budget-line"><span>🎯 งบประจำเดือน</span><b id="budgetAmt"></b></div>
      <div class="bar-bg"><div class="bar-fill exp" id="budgetBar" style="width:0%"></div></div>
      <div class="hint" id="budgetHint"></div>
    </div>
    <h2 class="sec">แนวโน้ม 6 เดือน</h2>
    <div class="card"><div class="chart" id="chart"></div>
      <div style="display:flex;gap:14px;justify-content:center;margin-top:8px;font-size:11px;color:var(--muted)">
        <span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--green);margin-right:4px"></i>รายรับ</span>
        <span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#FCA5A5;margin-right:4px"></i>รายจ่าย</span>
      </div>
    </div>
    <h2 class="sec">ยอดแยกตามหมวด</h2>
    <div class="card" id="cats"></div>
  </div>

  <!-- ============ รายการ ============ -->
  <div class="page" id="page-tx">
    <div class="monthnav">
      <button onclick="shiftMonth(-1)">‹</button>
      <span class="m-label" id="monthLabel2"></span>
      <button onclick="shiftMonth(1)">›</button>
    </div>
    <div class="card" id="txList"></div>
  </div>

  <!-- ============ ตั้งค่า ============ -->
  <div class="page" id="page-set">
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:10px">🎯 งบประจำเดือน</h3>
      <div class="field"><label>ยอดงบ (บาท) — ตั้ง 0 เพื่อลบ</label>
        <input type="number" id="budgetInput" min="0" placeholder="เช่น 15000"></div>
      <button class="btn-primary" onclick="saveBudget()">บันทึกงบ</button>
    </div>
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:10px">🧠 สอนบอทจำหมวด</h3>
      <div class="field"><label>คำสำคัญ เช่น "กาแฟ", "น้ำมัน"</label><input id="ruleKeyword" placeholder="กาแฟ"></div>
      <div class="field"><label>หมวดที่ควรจัด</label><input id="ruleCategory" placeholder="อาหารและเครื่องดื่ม"></div>
      <div class="seg" id="ruleType">
        <button data-t="expense" class="on-exp">💸 รายจ่าย</button>
        <button data-t="income">💰 รายรับ</button>
      </div>
      <button class="btn-primary" onclick="saveRule()">บันทึกกฎ</button>
      <div class="hint">ครั้งหน้าที่เพิ่มรายการด้วยคำนี้ บอทจะเดาหมวดให้เอง</div>
    </div>
    <div class="card">
      <h3 style="font-size:15px;margin-bottom:10px">📤 ส่งออกข้อมูล</h3>
      <button class="btn-ghost" onclick="exportCsv()">ดาวน์โหลด CSV เดือนนี้</button>
    </div>
  </div>
</div>

<button class="fab" onclick="openAdd()">+</button>

<div class="tabs">
  <button class="active" id="tab-home" onclick="showTab('home')"><span class="ico">📊</span>หน้าแรก</button>
  <button id="tab-tx" onclick="showTab('tx')"><span class="ico">🧾</span>รายการ</button>
  <button id="tab-set" onclick="showTab('set')"><span class="ico">⚙️</span>ตั้งค่า</button>
</div>

<div class="overlay" id="sheetOverlay">
  <div class="sheet">
    <h3 id="sheetTitle">เพิ่มรายการ</h3>
    <div class="seg" id="txType">
      <button data-t="expense" class="on-exp">💸 รายจ่าย</button>
      <button data-t="income">💰 รายรับ</button>
    </div>
    <div class="field" style="margin-top:12px"><label>จำนวนเงิน (บาท)</label><input type="number" id="fAmount" min="0" step="0.01" placeholder="0.00"></div>
    <div class="field"><label>ร้านค้า / รายละเอียด</label><input id="fMerchant" placeholder="เช่น กาแฟ 7-11" oninput="suggestCat(this.value)"></div>
    <div class="field"><label>หมวดหมู่</label><div class="chips" id="fCats"></div></div>
    <div class="field"><label>วันที่</label><input type="date" id="fDate"></div>
    <div id="suggestHint" class="hint" style="display:none"></div>
    <button class="btn-primary" id="saveBtn" onclick="saveTx()">บันทึกรายการ</button>
    <button class="btn-danger" id="deleteBtn" style="display:none" onclick="deleteTx()">ลบรายการนี้</button>
    <button class="btn-ghost" onclick="closeSheet()">ปิด</button>
  </div>
</div>

<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
const CATEGORIES = ['อาหารและเครื่องดื่ม','การเดินทาง','ของใช้ทั่วไป','บิลและสาธารณูปโภค','รายรับทั่วไป','อื่นๆ'];
const INCOME_CATS = ['เงินเดือน','ขายของ','รายรับทั่วไป','อื่นๆ'];
let state = { month: new Date().toISOString().slice(0,7), dash: null, editId: null, type: 'expense', category: 'อื่นๆ' };
let accessToken = '';

const fmt = n => Number(n||0).toLocaleString('th-TH', {maximumFractionDigits:2});
const TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const monthTh = m => { const [y,mm] = m.split('-'); return TH_M[+mm-1] + ' ' + (+y+543); };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type':'application/json', authorization: 'Bearer ' + accessToken } });
  if (res.status === 401) { document.getElementById('loading').textContent = 'หมดอายุการเข้าสู่ระบบ ปิดแล้วเปิดใหม่อีกครั้ง'; throw new Error('unauthorized'); }
  return res;
}

async function main() {
  try { await liff.init({ liffId: window.LIFF_ID }); } catch (e) {
    document.getElementById('loading').textContent = 'LIFF init ล้มเหลว: ' + e; return;
  }
  if (!liff.isLoggedIn()) { liff.login(); return; }
  accessToken = liff.getAccessToken();
  try {
    const p = await liff.getProfile();
    if (p.pictureUrl) document.getElementById('avatar').src = p.pictureUrl;
    document.getElementById('greet').textContent = 'สวัสดี, ' + (p.displayName || 'เพื่อน');
    document.getElementById('greetSub').textContent = 'ยินดีต้อนรับกลับมา 👋';
    // บันทึกชื่อโปรไฟล์ไว้ให้บอทใช้แสดงในสรุปแยกตามสมาชิก
    api('/api/liff/me', { method: 'POST', body: JSON.stringify({ name: p.displayName }) }).catch(() => {});
  } catch (e) {}
  await loadDash();
  showTab('home');
}

async function loadDash() {
  const r = await api('/api/liff/dashboard?month=' + state.month);
  if (!r.ok) { document.getElementById('loading').textContent = 'โหลดข้อมูลไม่สำเร็จ'; return; }
  state.dash = await r.json();
  document.getElementById('loading').style.display = 'none';
  render();
}

function render() {
  const d = state.dash, m = state.month;
  document.getElementById('monthLabel').textContent = monthTh(m);
  document.getElementById('monthLabel2').textContent = monthTh(m);
  const net = d.totals.income - d.totals.expense;
  const netEl = document.getElementById('net');
  netEl.textContent = (net >= 0 ? '฿' : '−฿') + fmt(Math.abs(net));
  netEl.className = 'v ' + (net >= 0 ? 'pos' : 'neg');
  document.getElementById('inc').textContent = '฿' + fmt(d.totals.income);
  document.getElementById('exp').textContent = '฿' + fmt(d.totals.expense);

  // budget
  const bc = document.getElementById('budgetCard');
  if (d.budget && d.budget > 0) {
    bc.style.display = 'block';
    const pct = Math.min(100, d.totals.expense / d.budget * 100);
    document.getElementById('budgetAmt').textContent = '฿' + fmt(d.totals.expense) + ' / ฿' + fmt(d.budget);
    document.getElementById('budgetBar').style.width = pct + '%';
    document.getElementById('budgetBar').style.background = pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#06C755';
    document.getElementById('budgetHint').textContent = pct >= 100 ? '⚠️ งบเกินแล้ว! ใช้ไป ' + Math.round(pct) + '% ของงบ' : 'ใช้ไปแล้ว ' + Math.round(pct) + '% ของงบเดือนนี้';
    document.getElementById('budgetInput').value = d.budget;
  } else { bc.style.display = 'none'; }

  // trend chart
  const maxV = Math.max(1, ...d.trend.map(t => Math.max(t.income, t.expense)));
  document.getElementById('chart').innerHTML = d.trend.length === 0 ? '<div class="empty" style="width:100%">ยังไม่มีข้อมูล</div>' :
    d.trend.map(t => '<div class="col"><div class="stack" style="height:' + Math.round((t.income+t.expense)/maxV*100) + '%">' +
      '<div class="s-inc" style="height:' + Math.round(t.income/(t.income+t.expense||1)*100) + '%"></div>' +
      '<div class="s-exp" style="height:' + Math.round(t.expense/(t.income+t.expense||1)*100) + '%"></div></div>' +
      '<div class="m">' + monthTh(t.month).split(' ')[0] + '</div></div>').join('');

  // categories
  const catEl = document.getElementById('cats');
  if (!d.categories.length) { catEl.innerHTML = '<div class="empty">ยังไม่มีรายการในเดือนนี้</div>'; }
  else {
    const maxC = Math.max(...d.categories.map(c => c.total));
    catEl.innerHTML = d.categories.map(c =>
      '<div class="bar-row"><div class="top"><span>' + (c.type==='income'?'💰 ':'💸 ') + esc(c.category) + '</span><span class="amt ' + (c.type==='income'?'pos':'neg') + '">฿' + fmt(c.total) + '</span></div>' +
      '<div class="bar-bg"><div class="bar-fill ' + (c.type==='expense'?'exp':'') + '" style="width:' + Math.round(c.total/maxC*100) + '%"></div></div></div>').join('');
  }

  // tx list
  const list = document.getElementById('txList');
  if (!d.transactions.length) { list.innerHTML = '<div class="empty">ไม่มีรายการ — กดปุ่ม + เพื่อเพิ่ม</div>'; }
  else list.innerHTML = d.transactions.map(txRow).join('');
}

function txRow(t) {
  const d = new Date(t.date + 'T00:00:00');
  const dstr = d.getDate() + ' ' + TH_M[d.getMonth()];
  return '<div class="tx ' + t.type + '" onclick="openEdit(\\'' + t.id + '\\')">' +
    '<div class="ic">' + (t.type==='income'?'💰':'🧾') + '</div>' +
    '<div class="mid"><div class="cat">' + esc(t.category) + (t.source!=='liff'?'<span class="badge">สลิป</span>':'') + '</div>' +
    '<div class="sub">' + dstr + (t.merchant ? ' · ' + esc(t.merchant) : '') + '</div></div>' +
    '<div class="amt ' + (t.type==='income'?'pos':'neg') + '">' + (t.type==='income'?'+':'−') + '฿' + fmt(t.amount) + '</div></div>';
}

function showTab(t) {
  ['home','tx','set'].forEach(k => {
    document.getElementById('page-' + k).classList.toggle('active', k === t);
    document.getElementById('tab-' + k).classList.toggle('active', k === t);
  });
  if (t !== 'set' && !state.dash) loadDash();
}
function shiftMonth(d) {
  const [y, m] = state.month.split('-').map(Number);
  const nd = new Date(y, m - 1 + d, 1);
  state.month = nd.getFullYear() + '-' + String(nd.getMonth()+1).padStart(2,'0');
  loadDash();
}

/* ---- add / edit sheet ---- */
function openAdd() {
  state.editId = null; state.type = 'expense';
  document.getElementById('sheetTitle').textContent = 'เพิ่มรายการ';
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('fAmount').value = '';
  document.getElementById('fMerchant').value = '';
  document.getElementById('fDate').value = new Date().toISOString().slice(0,10);
  setType('expense');
  renderCats();
  document.getElementById('sheetOverlay').classList.add('show');
}
function openEdit(id) {
  const t = state.dash.transactions.find(x => x.id === id);
  if (!t) return;
  state.editId = id; state.type = t.type;
  document.getElementById('sheetTitle').textContent = 'แก้ไขรายการ';
  document.getElementById('deleteBtn').style.display = 'block';
  document.getElementById('fAmount').value = t.amount;
  document.getElementById('fMerchant').value = t.merchant || '';
  document.getElementById('fDate').value = t.date;
  setType(t.type); state.category = t.category; renderCats();
  document.getElementById('sheetOverlay').classList.add('show');
}
function closeSheet() { document.getElementById('sheetOverlay').classList.remove('show'); }
function setType(t) {
  state.type = t;
  document.querySelectorAll('#txType button').forEach(b => {
    b.className = b.dataset.t === t ? (t === 'income' ? 'on-inc' : 'on-exp') : '';
  });
  renderCats();
}
document.querySelectorAll('#txType button').forEach(b => b.onclick = () => setType(b.dataset.t));
document.querySelectorAll('#ruleType button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#ruleType button').forEach(x => x.className = '');
  b.className = b.dataset.t === 'income' ? 'on-inc' : 'on-exp';
  b.dataset.ruleType = b.dataset.t;
});
function renderCats() {
  const cats = state.type === 'income' ? INCOME_CATS : CATEGORIES;
  if (!cats.includes(state.category)) state.category = cats[0];
  document.getElementById('fCats').innerHTML = cats.map(c =>
    '<button class="' + (c === state.category ? 'sel' : '') + '" onclick="pickCat(\\'' + esc(c) + '\\')">' + esc(c) + '</button>').join('');
}
function pickCat(c) { state.category = c; renderCats(); }

async function suggestCat(kw) {
  if (!kw || kw.length < 2) return;
  try {
    const r = await api('/api/liff/suggest-category', { method: 'POST', body: JSON.stringify({ keyword: kw }) });
    const j = await r.json();
    const hint = document.getElementById('suggestHint');
    if (j.rule) {
      hint.style.display = 'block';
      hint.textContent = '🧠 จากที่คุณสอนไว้: "' + kw + '" → ' + j.rule.category;
      state.type = j.rule.type; setType(j.rule.type); state.category = j.rule.category; renderCats();
    } else hint.style.display = 'none';
  } catch (e) {}
}

async function saveTx() {
  const amount = parseFloat(document.getElementById('fAmount').value);
  if (!amount || amount <= 0) { alert('กรอกจำนวนเงินก่อนนะ'); return; }
  const payload = {
    amount, type: state.type, category: state.category,
    merchant: document.getElementById('fMerchant').value || null,
    date: document.getElementById('fDate').value
  };
  if (state.editId) {
    await api('/api/liff/transactions/' + state.editId, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/liff/transactions', { method: 'POST', body: JSON.stringify(payload) });
    // จำรายการนี้ไว้เป็นกฎอัตโนมัติถ้าผู้ใช้เคยสอนไว้
    const kw = payload.merchant;
    if (kw) api('/api/liff/suggest-category', { method:'POST', body: JSON.stringify({keyword: kw}) }).catch(()=>{});
  }
  closeSheet();
  await loadDash();
  showTab(state.editId ? 'tx' : 'tx');
}
async function deleteTx() {
  if (!state.editId || !confirm('ลบรายการนี้?')) return;
  await api('/api/liff/transactions/' + state.editId, { method: 'DELETE' });
  closeSheet();
  await loadDash();
}

async function saveBudget() {
  const v = parseFloat(document.getElementById('budgetInput').value || '0');
  await api('/api/liff/budget', { method:'POST', body: JSON.stringify({ monthly_budget: v }) });
  alert('บันทึกงบเรียบร้อย');
  await loadDash();
}
async function saveRule() {
  const kw = document.getElementById('ruleKeyword').value.trim();
  const cat = document.getElementById('ruleCategory').value.trim();
  const typeBtn = document.querySelector('#ruleType button.on-inc, #ruleType button.on-exp');
  const type = (typeBtn && typeBtn.dataset.ruleType) === 'income' ? 'income' : 'expense';
  if (!kw || !cat) { alert('กรอกคำสำคัญและหมวดก่อนนะ'); return; }
  await api('/api/liff/category-rules', { method:'POST', body: JSON.stringify({ keyword: kw, category: cat, type }) });
  alert('สอนบอทแล้ว! 🧠');
  document.getElementById('ruleKeyword').value = '';
  document.getElementById('ruleCategory').value = '';
}
async function exportCsv() {
  const r = await api('/api/liff/export?month=' + state.month);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'transactions-' + state.month + '.csv';
  a.click();
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/\\\\/g,'&#92;'); }
main();
</script>
</body>
</html>`;
}
