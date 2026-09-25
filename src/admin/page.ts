/**
 * Admin observability dashboard served at GET /admin (no secrets in the page;
 * the admin key is entered in the browser and sent with every API call).
 * Same minimal white style as the LIFF page.
 */
export function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LineSave — Admin</title>
<style>
:root { --acc:#06C755; --red:#E5484D; --amber:#F59E0B; --bg:#FAFAFB; --card:#fff;
        --ink:#16181D; --muted:#9AA0A8; --line:#F0F0F2; --chip:#F4F5F6; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,'Segoe UI','Noto Sans Thai',sans-serif; background:var(--bg); color:var(--ink); padding:20px 16px 40px; }
.wrap { max-width:760px; margin:0 auto; }
h1 { font-size:19px; font-weight:800; letter-spacing:-.3px; margin:8px 0 2px; }
.sub { color:var(--muted); font-size:12.5px; margin-bottom:18px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:15px 16px; margin-bottom:12px; box-shadow:0 1px 2px rgba(16,24,40,.03); }
h2 { font-size:12px; color:var(--muted); font-weight:700; letter-spacing:.4px; text-transform:uppercase; margin:14px 4px 8px; }
.status { display:flex; align-items:center; gap:9px; padding:8px 0; border-bottom:1px solid var(--line); font-size:13.5px; }
.status:last-child { border-bottom:none; }
.dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
.dot.ok { background:var(--acc); } .dot.bad { background:var(--red); } .dot.warn { background:var(--amber); }
.status .nm { font-weight:650; min-width:120px; }
.status .dt { color:var(--muted); font-size:12px; margin-left:auto; text-align:right; }
.grid { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; }
.stat { background:var(--bg); border-radius:13px; padding:11px 12px; }
.stat .lbl { font-size:11px; color:var(--muted); }
.stat .v { font-size:21px; font-weight:800; margin-top:1px; }
.stat .v.err { color:var(--red); }
.stat .v.inf { color:var(--acc); }
.kv { display:flex; justify-content:space-between; font-size:13px; padding:7px 0; border-bottom:1px solid var(--line); }
.kv:last-child { border-bottom:none; }
.kv b { font-variant-numeric:tabular-nums; }
.kv .mut { color:var(--muted); font-size:11.5px; }
table { width:100%; border-collapse:collapse; font-size:12.5px; }
th { text-align:left; color:var(--muted); font-size:11px; padding:4px 6px; border-bottom:1px solid var(--line); }
td { padding:7px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
tr:last-child td { border-bottom:none; }
.lvl { font-size:10px; font-weight:800; border-radius:5px; padding:2px 7px; color:#fff; }
.lvl.error { background:var(--red); }
.tag { font-size:10px; background:var(--chip); border-radius:5px; padding:2px 7px; font-weight:650; }
.time { color:var(--muted); font-size:11px; white-space:nowrap; }
.detail { color:var(--muted); font-size:11.5px; max-width:320px; overflow-wrap:anywhere; }
.login { max-width:380px; margin:12vh auto 0; text-align:center; }
.login input { width:100%; border:1.5px solid var(--line); border-radius:12px; padding:12px 14px; font-size:14px; margin:12px 0; }
.login button { width:100%; border:none; background:var(--ink); color:#fff; border-radius:12px; padding:13px; font-size:14px; font-weight:700; cursor:pointer; }
#refresh { border:1.5px solid var(--line); background:var(--card); border-radius:10px; padding:7px 14px; font-size:12.5px; cursor:pointer; color:var(--ink); }
#refresh:disabled { color:var(--muted); }
.empty { color:var(--muted); text-align:center; padding:14px 0; font-size:13px; }
.err { color:var(--red); text-align:center; padding:20px; font-size:13.5px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>LineSave Observability 🛠️</h1>
  <div class="sub">Admin dashboard · ระบบบอท · LIFF · AI — <button id="refresh" onclick="load()">รีเฟรช</button> <span style="font-size:11px" id="gen"></span></div>
  <div id="root"><div class="empty">กำลังโหลด…</div></div>
</div>
<script>
let KEY = sessionStorage.getItem('adminKey') || '';
const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmtN = n => Number(n||0).toLocaleString('th-TH');
const fmtT = ts => { const d = new Date(ts*1000); return d.toLocaleDateString('th-TH',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}); };

function loginScreen(msg) {
  $('root').innerHTML = '<div class="login card"><h1>🔐 Admin Access</h1>' +
    '<div class="sub" style="margin:6px 0 0">' + (msg || 'ใส่ Admin Key เพื่อเข้าดูแดชบอร์ด') + '</div>' +
    '<input type="password" id="k" placeholder="ADMIN_KEY" onkeydown="if(event.key===\\'Enter\\')saveKey()">' +
    '<button onclick="saveKey()">เข้าสู่ระบบ</button></div>';
}
function saveKey() {
  KEY = $('k').value.trim();
  if (!KEY) return;
  sessionStorage.setItem('adminKey', KEY);
  load();
}
function logout() { sessionStorage.removeItem('adminKey'); KEY=''; loginScreen(); }

function dot(ok) { return '<span class="dot ' + (ok ? 'ok' : 'bad') + '"></span>'; }

async function load() {
  if (!KEY) { loginScreen(); return; }
  $('refresh').disabled = true;
  let d;
  try {
    const r = await fetch('/api/admin/overview', { headers: { 'x-admin-key': KEY } });
    if (r.status === 401) { KEY=''; sessionStorage.removeItem('adminKey'); loginScreen('Key ไม่ถูกต้อง ลองอีกครั้ง'); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    d = await r.json();
  } catch (e) {
    $('root').innerHTML = '<div class="err">โหลดข้อมูลไม่สำเร็จ: ' + esc(e.message) + '</div>';
    return;
  } finally { $('refresh').disabled = false; }
  $('gen').innerHTML = 'อัปเดต ' + new Date(d.generated_at).toLocaleTimeString('th-TH') + ' · <a href="#" onclick="logout()">ออกจากระบบ</a>';

  const s = d.services;
  const aiLast = d.ai24h.length ? Math.max(...d.ai24h.map(x => x.last_ts)) : null;
  const html =
    '<h2>สถานะระบบ</h2>' +
    '<div class="card">' +
      '<div class="status">' + dot(s.database.ok) + '<span class="nm">ฐานข้อมูล (D1)</span><span class="dt">' + esc(s.database.message) + '</span></div>' +
      '<div class="status">' + dot(s.ai.key_configured) + '<span class="nm">AI · Gemini Vision</span><span class="dt">' + esc(s.ai.model) + (s.ai.key_configured ? ' · เชื่อมต่ออยู่' : ' · ⚠️ ยังไม่ตั้ง GEMINI_API_KEY') +
        (aiLast ? '<br>เรียกล่าสุด ' + fmtT(aiLast) : '') + '</span></div>' +
      '<div class="status">' + dot(s.typhoon.key_configured) + '<span class="nm">OCR · Typhoon</span><span class="dt">' + esc(s.typhoon.model) + ' · ' + esc(s.typhoon.pipeline) + '</span></div>' +
      '<div class="status">' + dot(s.line.secret_configured && s.line.token_configured) + '<span class="nm">LINE Messaging API</span><span class="dt">' +
        (s.line.secret_configured && s.line.token_configured ? 'พร้อมใช้งาน' : '⚠️ ตั้งค่าไม่ครบ') + '</span></div>' +
      '<div class="status">' + dot(s.liff.id_configured) + '<span class="nm">LIFF</span><span class="dt">' +
        (s.liff.id_configured ? 'ตั้งค่าแล้ว' : '⚠️ ยังไม่มี LIFF_ID') + '</span></div>' +
    '</div>' +

    '<h2>เหตุการณ์ 24 ชม. / 7 วัน</h2>' +
    '<div class="grid" style="margin-bottom:4px">' +
      '<div class="stat"><div class="lbl">สำเร็จ (info)</div><div class="v inf">' + fmtN(d.counts24h.info) + ' <small style="font-size:11px;color:var(--muted)">/ ' + fmtN(d.counts7d.info) + '</small></div></div>' +
      '<div class="stat"><div class="lbl">เตือน (warn)</div><div class="v">' + fmtN(d.counts24h.warn) + ' <small style="font-size:11px;color:var(--muted)">/ ' + fmtN(d.counts7d.warn) + '</small></div></div>' +
      '<div class="stat"><div class="lbl">ผิดพลาด (error)</div><div class="v err">' + fmtN(d.counts24h.error) + ' <small style="font-size:11px;color:var(--muted)">/ ' + fmtN(d.counts7d.error) + '</small></div></div>' +
    '</div>' +

    '<h2>การใช้งาน AI</h2>' +
    '<div class="card">' +
      (d.ai24h.length === 0 ? '<div class="empty">ยังไม่มีการเรียก AI ใน 24 ชม.</div>' :
        d.ai24h.map(x =>
          '<div class="kv"><span>' + esc(x.event.replace(/_/g,' ')) + ' <span class="mut">· 7 วัน ' + fmtN((d.ai7d.find(y => y.event===x.event)||{}).count || 0) + ' ครั้ง</span></span><b>' + fmtN(x.count) + ' ครั้ง · ' + fmtT(x.last_ts) + '</b></div>'
        ).join('')) +
      '<div class="kv"><span class="mut">โมเดล</span><b>' + esc(s.ai.model) + '</b></div>' +
    '</div>' +

    '<h2>Error ล่าสุด (30 รายการ)</h2>' +
    '<div class="card">' +
      (d.recentErrors.length === 0 ? '<div class="empty">✨ ไม่มี error เลย — ระบบทำงานปกติ</div>' :
        '<table><tr><th>เวลา</th><th>ที่มา</th><th>รายละเอียด</th></tr>' +
        d.recentErrors.map(e =>
          '<tr><td class="time">' + fmtT(e.ts) + '</td><td><span class="tag">' + esc(e.source) + '</span> <span class="lvl error">' + esc(e.event) + '</span></td><td class="detail">' + esc(e.detail) + '</td></tr>'
        ).join('') + '</table>') +
    '</div>';
  $('root').innerHTML = html;
}
setInterval(load, 30000);
load();
</script>
</body>
</html>`;
}
