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
.lvl.lvl-warn { background:var(--amber); }
.lvl.audit { background:var(--ink); }
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
.live-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--acc); margin-right:6px; animation:blink 1.6s infinite; }
@keyframes blink { 0%,100% { opacity:1 } 50% { opacity:.25 } }
.out { font-size:10px; font-weight:800; border-radius:5px; padding:2px 7px; color:#fff; white-space:nowrap; }
.out.ok { background:var(--acc); } .out.fail { background:var(--red); }
.out.skip { background:#8E959E; } .out.proc { background:var(--amber); }
.live-ev { font-weight:700; font-size:12.5px; }
.live-src { font-size:10px; background:var(--chip); border-radius:5px; padding:2px 6px; font-weight:700; white-space:nowrap; }
.lat { color:var(--muted); font-size:11px; white-space:nowrap; }
.livetb td { padding:4px 6px; font-size:12px; }
.livetb th { padding:3px 6px; }
.morebtn { border:1.5px solid var(--line); background:var(--bg); border-radius:9px; padding:5px 14px; font-size:11.5px; cursor:pointer; color:var(--ink); }
.cols2 { display:grid; grid-template-columns:1fr 1fr; gap:0 12px; align-items:start; }
@media (max-width:640px) { .cols2 { grid-template-columns:1fr; } }
h2 { display:flex; align-items:center; gap:6px; }
.chip2 { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--line); font-size:13px; }
.chip2:last-child { border-bottom:none; }
.chip2 .dt { color:var(--muted); font-size:11.5px; margin-left:auto; text-align:right; }
td .detail { max-width:260px; }
@media (max-width:560px) {
  body { padding:14px 8px 32px; }
  h1 { font-size:17px; }
  .wrap { max-width:100%; }
  .card { padding:12px 11px; border-radius:13px; }
  table { font-size:11.5px; }
  th { font-size:10px; padding:3px 4px; }
  td { padding:5px 4px; }
  td .detail { max-width:130px; }
  .livetb td, .livetb th { padding:4px 3px; }
  .livetb .lat, .livetb th.lat, .livetb .latsrc { display:none; }
  .stat .v { font-size:17px; }
  .grid { gap:6px; }
  .kv { font-size:12px; }
  .kv .mut { font-size:10.5px; }
  .status .nm, .chip2 .nm { min-width:96px; font-size:12.5px; }
  .chip2 .dt { font-size:10.5px; }
  .cols2 { grid-template-columns:1fr; }
}
</style>
</head>
<body>
<div class="wrap">
  <h1>LineSave Observability 🛠️</h1>
  <div class="sub">Admin dashboard · ระบบบอท · LIFF · AI — <button id="refresh" onclick="load()">รีเฟรช</button> <span style="font-size:11px" id="gen"></span></div>
  <div id="root"><div class="empty">กำลังโหลด…</div></div>
</div>
<script>
// Written in conservative ES2017 (no ?. ?? or parameterless catch) so older
// mobile browsers can parse the whole script — one syntax error kills the page.
var store = {
  get: function(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set: function(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del: function(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
var KEY = store.get('adminKey') || '';
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtN(n) { return Number(n||0).toLocaleString('th-TH'); }
function fmtT(ts) { var d = new Date(ts*1000); return d.toLocaleDateString('th-TH',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}); }

function loginScreen(msg) {
  $('root').innerHTML = '<div class="login card"><h1>🔐 Admin Access</h1>' +
    '<div class="sub" style="margin:6px 0 0">' + (msg || 'ใส่รหัสผ่านเพื่อเข้าดูแดชบอร์ด') + '</div>' +
    '<input type="password" id="k" placeholder="รหัสผ่าน" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" onkeydown="if(event.key===\\'Enter\\'||event.keyCode===13)saveKey()">' +
    '<button type="button" onclick="toggleShow()" style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;margin-top:-8px">👁 แสดงรหัสที่พิมพ์</button>' +
    '<button onclick="saveKey()">เข้าสู่ระบบ</button></div>';
}
function toggleShow() {
  var k = $('k');
  k.type = k.type === 'password' ? 'text' : 'password';
}
function saveKey() {
  KEY = $('k').value.trim();
  if (!KEY) return;
  store.set('adminKey', KEY);
  load();
}
function logout() { store.del('adminKey'); KEY=''; loginScreen(); }

function dot(ok) { return '<span class="dot ' + (ok ? 'ok' : 'bad') + '"></span>'; }

async function load() {
  if (!KEY) { loginScreen(); return; }
  $('refresh').disabled = true;
  var d;
  try {
    var r = await fetch('/api/admin/overview', { headers: { 'x-admin-key': KEY } });
    if (r.status === 401) {
      var typedLen = KEY.length;
      KEY=''; store.del('adminKey');
      loginScreen('รหัสไม่ถูกต้อง (ที่พิมพ์มา ' + typedLen + ' ตัวอักษร — ต้องการ 10 ตัว) ลองอีกครั้ง หรือกด 👁 เพื่อดูที่พิมพ์');
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    d = await r.json();
  } catch (e) {
    $('root').innerHTML = '<div class="err">โหลดข้อมูลไม่สำเร็จ: ' + esc(e && e.message ? e.message : e) + '</div>';
    return;
  } finally { $('refresh').disabled = false; }
  $('gen').innerHTML = 'อัปเดต ' + new Date(d.generated_at).toLocaleTimeString('th-TH') + ' · <a href="#" onclick="logout()">ออกจากระบบ</a>';

  var s = d.services;
  var m = d.metrics || {};
  var slips = m.slips || {};
  var wl = m.webhook_latency || {};
  var al = m.ai_latency || {};
  var ocr = m.ocr || {};
  var reply = m.reply || {};
  var aiLast = d.ai24h.length ? Math.max.apply(null, d.ai24h.map(function(x){ return x.last_ts; })) : null;

  const alertBanner = (d.alerts && d.alerts.length)
    ? '<h2>การแจ้งเตือน</h2>' + d.alerts.map(a =>
        '<div class="card" style="border-color:' + (a.level === 'critical' ? 'var(--red)' : 'var(--amber)') + ';display:flex;gap:9px;align-items:baseline">' +
        '<span class="lvl ' + (a.level === 'critical' ? 'error' : 'lvl-warn') + '">' + (a.level === 'critical' ? 'CRITICAL' : 'WARNING') + '</span>' +
        '<span style="font-weight:700;font-size:13.5px">' + esc(a.name) + '</span>' +
        '<span class="detail">' + esc(a.detail) + '</span></div>'
      ).join('')
    : '';

  const fmtMs = function(v) { return v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v + ' ms'; };
  const pct = function(v, okBelow) {
    const cls = v > okBelow ? ' style="color:var(--red);font-weight:800"' : '';
    return '<span' + cls + '>' + Math.round(v * 100) + '%</span>';
  };
  const pctGood = function(v, okAbove) {
    const cls = v < okAbove ? ' style="color:var(--red);font-weight:800"' : '';
    return '<span' + cls + '>' + Math.round(v * 100) + '%</span>';
  };
  const metricsHtml =
    '<h2>เมตริก (24 ชม.)</h2>' +
    '<div class="card">' +
      '<div class="kv"><span>สลิปที่ประมวลผล</span><b>' + fmtN(slips.total || 0) + ' <span class="mut">(สำเร็จ ' + fmtN(slips.success || 0) + ' · ผิดพลาด ' + fmtN(slips.failed || 0) + ' · ไม่ใช่สลิป ' + fmtN(slips.ignored || 0) + ')</span></b></div>' +
      '<div class="kv"><span>ตัดเป็น "ไม่ใช่สลิป" <span class="mut">(24 ชม. · 1 ชม. ' + fmtN(slips.not_slip_1h || 0) + ')</span></span><b>' + ((slips.not_slip || 0) >= 3 ? '<span style="color:var(--amber);font-weight:800">' : '') + fmtN(slips.not_slip || 0) + '</b></div>' +
      '<div class="kv"><span>อัตราประมวลผลล้มเหลว <span class="mut">(สลิปที่พังกลางทาง)</span></span><b>' + pct((slips.failed || 0) / Math.max(1, slips.total || 0), 0.1) + '</b></div>' +
      '<div class="kv"><span>OCR fail rate <span class="mut">(7 วัน · 1 ชม. ' + pct(ocr.failRate1h || 0, 0.2) + ')</span></span><b>' + pct(ocr.failRate || 0, 0.2) + '</b></div>' +
      '<div class="kv"><span>Webhook latency p50 / p95</span><b>' + fmtMs(wl.p50) + ' / ' + fmtMs(wl.p95) + ' <span class="mut">(n=' + fmtN(wl.samples || 0) + ')</span></b></div>' +
      '<div class="kv"><span>Gemini latency p50 / p95</span><b>' + fmtMs(al.p50) + ' / ' + fmtMs(al.p95) + ' <span class="mut">(n=' + fmtN(al.samples || 0) + ')</span></b></div>' +
      '<div class="kv"><span>Active users</span><b>' + fmtN(m.active_users_24h || 0) + '</b></div>' +
      '<div class="kv"><span>LINE reply success rate</span><b>' + pctGood(reply.successRate == null ? 1 : reply.successRate, 0.95) + ' <span class="mut">(' + fmtN(reply.ok || 0) + ' ok / ' + fmtN(reply.fail || 0) + ' fail)</span></b></div>' +
      '<div class="kv"><span>สลิปค้างใน pipeline</span><b>' + (m.pending_slips > 0 ? '<span style="color:var(--red);font-weight:800">' + fmtN(m.pending_slips) + '</span>' : '0') + '</b></div>' +
      '<div class="kv"><span>Signature ผิดพลาด (1 ชม.)</span><b>' + (m.signature_failures_1h >= 5 ? '<span style="color:var(--red);font-weight:800">' + fmtN(m.signature_failures_1h) + '</span>' : fmtN(m.signature_failures_1h || 0)) + '</b></div>' +
      '<div class="kv"><span>Error แยกตามที่มา <span class="mut">(24 ชม.)</span></span><b>' +
        ((m.errors_by_source || []).length ? (m.errors_by_source || []).map(function(x) { return esc(x.source) + ': ' + fmtN(x.count); }).join(' · ') : '<span class="mut">ไม่มี</span>') +
      '</b></div>' +
    '</div>';

  const auditHtml =
    '<h2>Audit log (15 รายการล่าสุด)</h2>' +
    '<div class="card">' +
      ((d.audit || []).length === 0 ? '<div class="empty">ยังไม่มีการแก้ไขข้อมูล</div>' :
        '<table><tr><th>เวลา</th><th>ผู้ใช้</th><th>รายการ</th></tr>' +
        d.audit.map(e =>
          '<tr><td class="time">' + fmtT(e.ts) + '</td><td><span class="tag">' + esc(e.actor.slice(0, 8)) + '…</span> <span class="lvl audit">' + esc(e.action) + '</span></td>' +
          '<td class="detail">' + esc(e.entity) + (e.entity_id ? ' #' + esc(e.entity_id) : '') + (e.detail ? ' — ' + esc(e.detail) : '') + '</td></tr>'
        ).join('') + '</table>') +
    '</div>';

  const html =
    '<h2><span class="live-dot"></span>Live · กิจกรรมล่าสุด <span class="mut" style="font-size:11px;font-weight:600;text-transform:none;letter-spacing:0" id="liveAt"></span></h2>' +
    '<div class="card" id="liveCard"><div class="empty">กำลังโหลด…</div></div>' +
    alertBanner +
    '<div class="cols2">' +
    '<div>' +
    '<h2>สถานะระบบ</h2>' +
    '<div class="card">' +
      '<div class="chip2">' + dot(s.database.ok) + '<span class="nm">ฐานข้อมูล (D1)</span><span class="dt">' + esc(s.database.message) + '</span></div>' +
      '<div class="chip2">' + dot(s.ai.key_configured) + '<span class="nm">AI · Gemini</span><span class="dt">' + esc(s.ai.model) + (s.ai.key_configured ? ' · เชื่อมต่ออยู่' : ' · ⚠️ ยังไม่ตั้ง GEMINI_API_KEY') +
        (aiLast ? '<br>เรียกล่าสุด ' + fmtT(aiLast) : '') + '</span></div>' +
      '<div class="chip2">' + dot(s.typhoon.key_configured) + '<span class="nm">OCR · Typhoon</span><span class="dt">' + esc(s.typhoon.model) + '</span></div>' +
      '<div class="chip2">' + dot(s.line.secret_configured && s.line.token_configured) + '<span class="nm">LINE Messaging API</span><span class="dt">' +
        (s.line.secret_configured && s.line.token_configured ? 'พร้อมใช้งาน' : '⚠️ ตั้งค่าไม่ครบ') + '</span></div>' +
      '<div class="chip2">' + dot(s.liff.id_configured) + '<span class="nm">LIFF</span><span class="dt">' +
        (s.liff.id_configured ? 'ตั้งค่าแล้ว' : '⚠️ ยังไม่มี LIFF_ID') + '</span></div>' +
    '</div>' +
    '</div>' +
    '<div>' +
    metricsHtml +
    '</div>' +
    '</div>' +

    '<div class="cols2">' +
    '<div>' +
    '<h2>การใช้งาน AI</h2>' +
    '<div class="card">' +
      (d.ai24h.length === 0 ? '<div class="empty">ยังไม่มีการเรียก AI ใน 24 ชม.</div>' :
        d.ai24h.map(x =>
          '<div class="kv"><span>' + esc(x.event.replace(/_/g,' ')) + ' <span class="mut">· 7 วัน ' + fmtN((d.ai7d.find(y => y.event===x.event)||{}).count || 0) + ' ครั้ง</span></span><b>' + fmtN(x.count) + ' ครั้ง · ' + fmtT(x.last_ts) + '</b></div>'
        ).join('')) +
      '<div class="kv"><span class="mut">โมเดล</span><b>' + esc(s.ai.model) + '</b></div>' +
    '</div>' +
    '</div>' +
    '<div>' +
    '<h2>เหตุการณ์ 24 ชม. / 7 วัน</h2>' +
    '<div class="grid" style="margin-bottom:4px">' +
      '<div class="stat"><div class="lbl">สำเร็จ (info)</div><div class="v inf">' + fmtN(d.counts24h.info) + ' <small style="font-size:11px;color:var(--muted)">/ ' + fmtN(d.counts7d.info) + '</small></div></div>' +
      '<div class="stat"><div class="lbl">เตือน (warn)</div><div class="v">' + fmtN(d.counts24h.warn) + ' <small style="font-size:11px;color:var(--muted)">/ ' + fmtN(d.counts7d.warn) + '</small></div></div>' +
      '<div class="stat"><div class="lbl">ผิดพลาด (error)</div><div class="v err">' + fmtN(d.counts24h.error) + ' <small style="font-size:11px;color:var(--muted)">/ ' + fmtN(d.counts7d.error) + '</small></div></div>' +
    '</div>' +
    '</div>' +
    '</div>' +

    '<div class="cols2">' +
    '<div>' +
    auditHtml +
    '</div>' +
    '<div>' +
    '<h2>Error ล่าสุด (30 รายการ)</h2>' +
    '<div class="card">' +
      (d.recentErrors.length === 0 ? '<div class="empty">✨ ไม่มี error เลย — ระบบทำงานปกติ</div>' :
        '<table><tr><th>เวลา</th><th>ที่มา</th><th>รายละเอียด</th></tr>' +
        d.recentErrors.map(e =>
          '<tr><td class="time">' + fmtT(e.ts) + '</td><td><span class="tag">' + esc(e.source) + '</span> <span class="lvl error">' + esc(e.event) + '</span></td><td class="detail">' + esc(e.detail) + '</td></tr>'
        ).join('') + '</table>') +
    '</div>' +
    '</div>' +
    '</div>';
  $('root').innerHTML = html;
  loadLive();
}

// ================= Live activity feed (polled every 4s) =================
var liveLimit = 15;                 // compact by default — "แสดงเพิ่ม" expands
var EV = {
  'message.image': 'ส่งรูปสลิป', 'message.text': 'ส่งข้อความ', 'message.sticker': 'ส่งสติกเกอร์',
  'postback': 'กดปุ่มในแชท', 'follow': 'เพิ่มเพื่อนบอท',
  'slip_saved': 'บันทึกสลิปแล้ว', 'stage_not_slip': 'ตัดว่าไม่ใช่สลิป',
  'reply_ok': 'ตอบกลับสำเร็จ', 'reply_fail': 'ตอบกลับไม่สำเร็จ',
  'internal_transfer': 'โอนข้ามบัญชี (ไม่บันทึก)', 'duplicate_detected': 'พบสลิปซ้ำ — ถามผู้ใช้',
  'self_rule_income': 'กฎชื่อตัวเอง → รายรับ', 'self_rule_expense': 'กฎชื่อตัวเอง → รายจ่าย',
  'tail_rule_income': 'กฎเลขบัญชี → รายรับ', 'tail_rule_expense': 'กฎเลขบัญชี → รายจ่าย',
  'dup_recent_batch_autosaved': 'สลิปชุดเดียวกัน — บันทึกเพิ่ม', 'contact_memory_income': 'จำชื่อคนโอน → รายรับ',
  'ocr_parser_hit': 'อ่านสลิปด้วยกฎ (ไม่ใช้ AI)', 'ocr_parser_miss': 'กฎอ่านไม่ได้ → ส่งต่อ AI',
  'gemini_call_ok': 'เรียก AI สำเร็จ', 'gemini_call_fail': 'เรียก AI ไม่สำเร็จ',
  'gemini_quota_exceeded': 'โควตา AI หมด', 'gemini_cache_hit': 'ใช้ผลเดิมจากแคช',
  'typhoon_ocr_ok': 'OCR สำเร็จ', 'typhoon_ocr_fail': 'OCR ล้มเหลว', 'typhoon_ocr_stats': 'OCR อ่านข้อความได้',
  'content_download_ok': 'ดาวน์โหลดรูปจาก LINE', 'content_download_fail': 'ดาวน์โหลดรูปไม่สำเร็จ',
  'signature_invalid': 'เว็บฮุคลายเซ็นผิด', 'event_processing_error': 'ประมวลผลพลาด',
  'amount_crosscheck_fix': 'แก้ยอดให้ตรง OCR', 'amount_crosscheck_mismatch': 'ยอดไม่ตรงกับ OCR',
  'future_date_rejected': 'ตัดวันที่ในอนาคต', 'vision_extraction_failed': 'อ่านสลิปล้มเหลว'
};
var STAGE = {
  'received': 'รับรูปเข้ามา', 'downloading': 'กำลังดาวน์โหลด', 'extracting': 'กำลังอ่าน',
  'extracted': 'อ่านเสร็จ', 'awaiting_confirm': 'รอยืนยันสลิปซ้ำ', 'saving': 'กำลังบันทึก',
  'saved': 'บันทึกแล้ว', 'replied': 'ตอบกลับแล้ว', 'not_slip': 'ไม่ใช่สลิป', 'skipped': 'ข้าม'
};
function evLabel(e) { return EV[e] || String(e || '').replace(/_/g, ' '); }
function outBadge(outcome, detail) {
  if (outcome === 'success') return '<span class="out ok">สำเร็จ</span>';
  if (outcome === 'failed') return '<span class="out fail">ล้มเหลว</span>';
  if (outcome === 'processing') return '<span class="out proc">กำลังประมวลผล</span>';
  var label = detail === 'duplicate' ? 'สลิปซ้ำ' : detail === 'not_slip' ? 'ไม่ใช่สลิป'
    : detail === 'internal_transfer' ? 'โอนข้ามบัญชี' : 'ข้าม';
  return '<span class="out skip">' + label + '</span>';
}
function who(row) {
  var u = row.user_hash ? '<span class="tag">' + esc(String(row.user_hash).slice(0, 8)) + '…</span>' : '';
  var g = row.group_id ? ' <span class="tag">กลุ่ม ' + esc(String(row.group_id).slice(-6)) + '</span>' : '';
  return u + g;
}
function loadLive() {
  if (!KEY) return;
  fetch('/api/admin/live', { headers: { 'x-admin-key': KEY } })
    .then(function (r) {
      if (r.status === 401) { KEY = ''; store.del('adminKey'); loginScreen(); throw new Error('unauth'); }
      return r.ok ? r.json() : null;
    })
    .then(function (d) {
      if (!d) return;
      var rows = [];
      (d.requests || []).forEach(function (r) {
        rows.push({
          ts: r.ts, sort: r.ts,
          html: '<td class="time">' + fmtT(r.ts) + '</td>' +
            '<td><span class="live-src">ผู้ใช้</span></td>' +
            '<td><span class="live-ev">' + evLabel(r.event_type) + '</span> ' + who(r) +
            (r.detail ? ' <span class="detail">' + esc(r.detail).slice(0, 80) + '</span>' : '') + '</td>' +
            '<td>' + outBadge(r.outcome, r.detail) + '</td>' +
            '<td class="lat">' + (r.latency_ms != null ? (r.latency_ms >= 1000 ? (r.latency_ms / 1000).toFixed(1) + 's' : r.latency_ms + 'ms') : '') + '</td>'
        });
      });
      (d.slips || []).forEach(function (s) {
        rows.push({
          ts: s.updated_ts, sort: s.updated_ts + 0.5,
          html: '<td class="time">' + fmtT(s.updated_ts) + '</td>' +
            '<td><span class="live-src">สลิป</span></td>' +
            '<td><span class="live-ev">' + esc(STAGE[s.stage] || s.stage) + '</span> <span class="tag">#' + esc(String(s.message_id).slice(-6)) + '</span></td>' +
            '<td>' + (s.status === 'done' ? '<span class="out ok">จบแล้ว</span>' : s.status === 'failed' ? '<span class="out fail">ล้มเหลว</span>' : '<span class="out proc">พอดี</span>') + '</td>' +
            '<td class="lat"></td>'
        });
      });
      (d.events || []).forEach(function (e) {
        rows.push({
          ts: e.ts, sort: e.ts,
          html: '<td class="time">' + fmtT(e.ts) + '</td>' +
            '<td><span class="live-src">' + esc(e.source) + '</span></td>' +
            '<td><span class="live-ev">' + esc(evLabel(e.event)) + '</span>' +
            (e.level !== 'info' ? ' <span class="lvl ' + (e.level === 'error' ? 'error' : 'lvl-warn') + '">' + (e.level === 'error' ? 'ERROR' : 'WARN') + '</span>' : '') +
            (e.detail ? ' <span class="detail">' + esc(e.detail).slice(0, 100) + '</span>' : '') + '</td>' +
            '<td></td><td class="lat"></td>'
        });
      });
      rows.sort(function (a, b) { return b.sort - a.sort; });
      var card = $('liveCard');
      if (card) {
        var shown = rows.slice(0, liveLimit);
        card.innerHTML = rows.length === 0
          ? '<div class="empty">ยังไม่มีกิจกรรมใน 6 ชม. ล่าสุด — ส่งสลิปเข้าบอทดูได้เลย</div>'
          : '<table class="livetb"><tr><th>เวลา</th><th></th><th>เหตุการณ์</th><th>ผล</th><th class="lat"></th></tr>' +
            shown.map(function (x) { return '<tr>' + x.html + '</tr>'; }).join('') + '</table>' +
            (rows.length > liveLimit
              ? '<div style="text-align:center;padding:8px 0 2px"><button class="morebtn" onclick="toggleLive()">แสดงเพิ่ม (' + (rows.length - liveLimit) + ' แถว)</button></div>'
              : '') +
            (liveLimit > 15
              ? '<div style="text-align:center;padding:4px 0 0"><button class="morebtn" onclick="toggleLive()">ย่อ</button></div>'
              : '');
      }
      var at = $('liveAt');
      if (at) at.textContent = '· อัปเดต ' + new Date(d.now * 1000).toLocaleTimeString('th-TH');
    })
    .catch(function (e) { /* transient poll failure — next tick retries */ });
}
function toggleLive() { liveLimit = liveLimit > 15 ? 15 : 45; loadLive(); }
setInterval(load, 15000);        // metrics & status
setInterval(loadLive, 4000);     // live activity feed
// Support one-tap login links: /admin?key=... — consume the param and strip it from the URL
(function () {
  try {
    var qm = location.search.match(/[?&]key=([^&]*)/);
    if (qm) {
      var k = decodeURIComponent(qm[1]).trim();
      if (k) { KEY = k; store.set('adminKey', k); }
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) { /* ignore */ }
})();
load();
</script>
</body>
</html>`;
}
