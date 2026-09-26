/**
 * Metrics & alert queries for the admin dashboard, derived from
 * request_logs + system_events. No external APM needed at this scale.
 */
import { D1Database } from './client';

const DAY = 60 * 60 * 24;
const HOUR = 60 * 60;

function cutoffOf(windowSeconds: number): number {
  return Math.floor(Date.now() / 1000) - windowSeconds;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface SlipMetrics {
  total: number;
  success: number;
  failed: number;
  ignored: number;
  stuck: number; // 'processing' for > 5 min — pipeline broke mid-way
  not_slip: number; // "not a slip" verdicts (24h) — spikes mean reading problems
  not_slip_1h: number;
}

/** Slip pipeline throughput and failure counts within the window. */
export async function getSlipMetrics(db: D1Database, windowSeconds: number = DAY): Promise<SlipMetrics> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(outcome = 'success'), 0)   AS success,
         COALESCE(SUM(outcome = 'failed'), 0)    AS failed,
         COALESCE(SUM(outcome = 'ignored'), 0)   AS ignored,
         COALESCE(SUM(outcome = 'processing' AND ts < ?), 0) AS stuck
       FROM request_logs
       WHERE event_type = 'message.image' AND ts >= ?`
    )
    .bind(cutoffOf(5 * 60), cutoffOf(windowSeconds))
    .first();
  const ns = await db
    .prepare(
      `SELECT
         COALESCE(SUM(ts >= ?), 0) AS not_slip_1h,
         COUNT(*) AS not_slip
       FROM request_logs
       WHERE event_type = 'message.image' AND outcome = 'ignored' AND error = 'not_slip' AND ts >= ?`
    )
    .bind(cutoffOf(HOUR), cutoffOf(windowSeconds))
    .first();
  return {
    total: Number(row?.total ?? 0),
    success: Number(row?.success ?? 0),
    failed: Number(row?.failed ?? 0),
    ignored: Number(row?.ignored ?? 0),
    stuck: Number(row?.stuck ?? 0),
    not_slip: Number(ns?.not_slip ?? 0),
    not_slip_1h: Number(ns?.not_slip_1h ?? 0)
  };
}

export interface LatencyStats {
  p50: number | null;
  p95: number | null;
  samples: number;
}

/** End-to-end webhook latency for image (slip) requests. */
export async function getWebhookLatency(db: D1Database, windowSeconds: number = DAY): Promise<LatencyStats> {
  const { results } = await db
    .prepare(
      `SELECT latency_ms AS l FROM request_logs
       WHERE event_type = 'message.image' AND latency_ms IS NOT NULL AND ts >= ?
       ORDER BY latency_ms LIMIT 1000`
    )
    .bind(cutoffOf(windowSeconds))
    .all();
  const latencies = (results || []).map(r => Number(r.l)).sort((a, b) => a - b);
  return { p50: percentile(latencies, 50), p95: percentile(latencies, 95), samples: latencies.length };
}

/** Gemini call latency (separate from the total webhook latency). */
export async function getAiLatency(db: D1Database, windowSeconds: number = DAY): Promise<LatencyStats> {
  const { results } = await db
    .prepare(
      `SELECT latency_ms AS l FROM system_events
       WHERE event = 'gemini_call_ok' AND latency_ms IS NOT NULL AND ts >= ?
       ORDER BY latency_ms LIMIT 1000`
    )
    .bind(cutoffOf(windowSeconds))
    .all();
  const latencies = (results || []).map(r => Number(r.l)).sort((a, b) => a - b);
  return { p50: percentile(latencies, 50), p95: percentile(latencies, 95), samples: latencies.length };
}

export interface OcrStats {
  ok: number;
  fail: number;
  failRate: number; // 0..1 over the last hour
  failRate1h: number;
}

/** OCR failure rate — the primary health metric of this system. */
export async function getOcrStats(db: D1Database): Promise<OcrStats> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(event = 'typhoon_ocr_ok'), 0) AS ok,
         COALESCE(SUM(event = 'typhoon_ocr_fail'), 0) AS fail,
         COALESCE(SUM(event = 'typhoon_ocr_fail' AND ts >= ?), 0) AS fail1h
       FROM system_events WHERE ts >= ?`
    )
    .bind(cutoffOf(HOUR), cutoffOf(7 * DAY))
    .first();
  const ok = Number(row?.ok ?? 0);
  const fail = Number(row?.fail ?? 0);
  const fail1h = Number(row?.fail1h ?? 0);
  return {
    ok,
    fail,
    failRate: ok + fail > 0 ? fail / (ok + fail) : 0,
    failRate1h: ok + fail1h > 0 ? fail1h / (ok + fail1h) : 0
  };
}

/** Error counts grouped by source (ai / line / db / bot / liff / system). */
export async function getErrorsBySource(
  db: D1Database,
  windowSeconds: number = DAY
): Promise<{ source: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT source, COUNT(*) AS count FROM system_events
       WHERE level = 'error' AND ts >= ? GROUP BY source ORDER BY count DESC`
    )
    .bind(cutoffOf(windowSeconds))
    .all();
  return (results || []).map(r => ({ source: String(r.source), count: Number(r.count) }));
}

/** Distinct active users (hashed) within the window. */
export async function getActiveUsers(db: D1Database, windowSeconds: number = DAY): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(DISTINCT user_hash) AS n FROM request_logs WHERE user_hash IS NOT NULL AND ts >= ?')
    .bind(cutoffOf(windowSeconds))
    .first();
  return Number(row?.n ?? 0);
}

export interface ReplyStats {
  ok: number;
  fail: number;
  successRate: number; // 0..1
}

/** LINE reply/push success rate within the window. */
export async function getReplyStats(db: D1Database, windowSeconds: number = DAY): Promise<ReplyStats> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(event = 'reply_ok'), 0) AS ok,
         COALESCE(SUM(event = 'reply_fail'), 0) AS fail
       FROM system_events WHERE source = 'line' AND ts >= ?`
    )
    .bind(cutoffOf(windowSeconds))
    .first();
  const ok = Number(row?.ok ?? 0);
  const fail = Number(row?.fail ?? 0);
  return { ok, fail, successRate: ok + fail > 0 ? ok / (ok + fail) : 1 };
}

/** Signature validation failures — spikes mean someone is probing the endpoint or the config is wrong. */
export async function getSignatureFailures(db: D1Database, windowSeconds: number = HOUR): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM system_events
       WHERE event = 'signature_invalid' AND ts >= ?`
    )
    .bind(cutoffOf(windowSeconds))
    .first();
  return Number(row?.n ?? 0);
}

/** Slips that entered the pipeline but never completed (excluding the last 2 min, which may just be in flight). */
export async function getPendingSlipCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM pending_slips
       WHERE status = 'pending' AND updated_ts < ?`
    )
    .bind(Math.floor(Date.now() / 1000) - 2 * 60)
    .first();
  return Number(row?.n ?? 0);
}

export interface AuditRow {
  ts: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: string | null;
}

/** Recent data mutations (who changed what, when). */
export async function getRecentAudit(db: D1Database, limit = 20): Promise<AuditRow[]> {
  const { results } = await db
    .prepare('SELECT ts, actor, action, entity, entity_id, detail FROM audit_log ORDER BY ts DESC LIMIT ?')
    .bind(limit)
    .all();
  return (results || []).map(r => ({
    ts: Number(r.ts),
    actor: String(r.actor),
    action: String(r.action),
    entity: String(r.entity),
    entity_id: r.entity_id ?? null,
    detail: r.detail ?? null
  }));
}

export interface LiveRequestRow {
  ts: number;
  request_id: string;
  event_type: string;
  outcome: string;
  detail: string | null;
  latency_ms: number | null;
  user_hash: string | null;
  group_id: string | null;
}

export interface LiveEventRow {
  ts: number;
  level: string;
  source: string;
  event: string;
  detail: string | null;
  request_id: string | null;
}

export interface LiveSlipRow {
  message_id: string;
  stage: string;
  status: string;
  updated_ts: number;
}

export interface LiveFeed {
  now: number;
  requests: LiveRequestRow[];
  events: LiveEventRow[];
  slips: LiveSlipRow[];
}

/**
 * Everything that just happened, for the admin live view: who sent what,
 * how the pipeline handled it, and what the bot replied — all real rows.
 */
export async function getLiveFeed(
  db: D1Database,
  windowSeconds: number = 6 * 60 * 60
): Promise<LiveFeed> {
  const cutoff = cutoffOf(windowSeconds);
  const [requests, events, slips] = await Promise.all([
    db
      .prepare(
        `SELECT ts, request_id, event_type, outcome, error AS detail, latency_ms, user_hash, group_id
         FROM request_logs WHERE ts >= ?
         ORDER BY ts DESC LIMIT 80`
      )
      .bind(cutoff)
      .all(),
    db
      .prepare(
        `SELECT ts, level, source, event, detail, request_id
         FROM system_events WHERE ts >= ?
         ORDER BY ts DESC LIMIT 160`
      )
      .bind(cutoff)
      .all(),
    db
      .prepare(
        `SELECT message_id, stage, status, updated_ts FROM pending_slips
         ORDER BY updated_ts DESC LIMIT 40`
      )
      .all()
  ]);
  return {
    now: Math.floor(Date.now() / 1000),
    requests: (requests.results || []).map(r => ({
      ts: Number(r.ts),
      request_id: String(r.request_id ?? ''),
      event_type: String(r.event_type ?? ''),
      outcome: String(r.outcome ?? ''),
      detail: r.detail ?? null,
      latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
      user_hash: r.user_hash ?? null,
      group_id: r.group_id ?? null
    })),
    events: (events.results || []).map(r => ({
      ts: Number(r.ts),
      level: String(r.level ?? 'info'),
      source: String(r.source ?? ''),
      event: String(r.event ?? ''),
      detail: r.detail ?? null,
      request_id: r.request_id ?? null
    })),
    slips: (slips.results || []).map(r => ({
      message_id: String(r.message_id ?? ''),
      stage: String(r.stage ?? ''),
      status: String(r.status ?? ''),
      updated_ts: Number(r.updated_ts ?? 0)
    }))
  };
}

export interface Alert {
  level: 'critical' | 'warning';
  name: string;
  detail: string;
}

/**
 * Threshold-based alerts, evaluated on every dashboard load:
 *  - OCR failure rate > 20% in the last hour
 *  - errors in 2+ consecutive recent hours (5xx-style sustained failure)
 *  - LINE reply failures present in the last 24h
 *  - slips stuck mid-pipeline
 *  - signature validation failures in the last hour
 */
export async function getAlerts(db: D1Database): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // Gemini quota exhausted — slips cannot be read until the quota resets
  // (daily reset) or billing is enabled. This must be loud, not a silent
  // stream of "not a slip" verdicts.
  const quotaRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM system_events
       WHERE event = 'gemini_quota_exceeded' AND ts >= ?`
    )
    .bind(cutoffOf(6 * HOUR))
    .first();
  if (Number(quotaRow?.n ?? 0) > 0) {
    alerts.push({
      level: 'critical',
      name: 'โควตา Gemini หมด',
      detail: `API คืน 429 quota ${Number(quotaRow?.n ?? 0)} ครั้งใน 6 ชม. — สลิปจะไม่ถูกอ่านจนกว่าโควตาจะรีเซ็ตหรือเปิดบิล (billing)`
    });
  }

  const ocr = await getOcrStats(db);
  if (ocr.ok + ocr.fail >= 5 && ocr.failRate1h > 0.2) {
    alerts.push({
      level: 'critical',
      name: 'OCR ล้มเหลวสูง',
      detail: `อัตรา fail ${Math.round(ocr.failRate1h * 100)}% ใน 1 ชม. (เกินเกณฑ์ 20%)`
    });
  }

  // Errors in 2+ consecutive hours = sustained failure, not a one-off
  const hours = await db
    .prepare(
      `SELECT (ts / 3600) AS h, COUNT(*) AS n FROM system_events
       WHERE level = 'error' AND ts >= ? GROUP BY h ORDER BY h DESC LIMIT 6`
    )
    .bind(cutoffOf(6 * HOUR))
    .all();
  const hourRows = (hours.results || []).map(r => ({ h: Number(r.h), n: Number(r.n) }));
  const currentHour = Math.floor(Date.now() / 1000 / 3600);
  const badHours = [0, 1, 2].filter(offset => {
    const row = hourRows.find(r => r.h === currentHour - offset);
    return row && row.n >= 3;
  }).length;
  if (badHours >= 2) {
    alerts.push({
      level: 'critical',
      name: 'Error ต่อเนื่อง',
      detail: `มี error เกิน 3 รายการใน ${badHours} ชั่วโมงล่าสุด`
    });
  }

  const reply = await getReplyStats(db);
  if (reply.fail > 0) {
    alerts.push({
      level: 'warning',
      name: 'LINE reply ล้มเหลว',
      detail: `${reply.fail} ครั้งใน 24 ชม. (สำเร็จ ${reply.ok} ครั้ง) — ตรวจ token/quota`
    });
  }

  const stuck = await getPendingSlipCount(db);
  if (stuck > 0) {
    alerts.push({
      level: 'warning',
      name: 'สลิปค้างใน pipeline',
      detail: `${stuck} รายการเข้ามาแล้วแต่บันทึกไม่เสร็จ`
    });
  }

  // Many "not a slip" verdicts in the last hour — either users are really
  // sending non-slips, or reading (OCR/LLM) is silently failing.
  const slips1h = await getSlipMetrics(db, HOUR);
  const imgs1hRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM request_logs
       WHERE event_type = 'message.image' AND ts >= ?`
    )
    .bind(cutoffOf(HOUR))
    .first();
  const imgs1h = Number(imgs1hRow?.n ?? 0);
  if (slips1h.not_slip_1h >= 3 && imgs1h > 0 && slips1h.not_slip_1h / imgs1h >= 0.6) {
    alerts.push({
      level: 'warning',
      name: 'อ่านสลิปไม่ผ่านเป็นจำนวนมาก',
      detail: `${slips1h.not_slip_1h}/${imgs1h} รูปใน 1 ชม. ถูกตัดเป็น "ไม่ใช่สลิป" — ตรวจ OCR/AI logs`
    });
  }

  const sigFails = await getSignatureFailures(db);
  if (sigFails >= 5) {
    alerts.push({
      level: 'warning',
      name: 'Webhook signature ผิดบ่อย',
      detail: `${sigFails} ครั้งใน 1 ชม. — อาจมีคนยิง endpoint หรือ config ผิด`
    });
  }

  return alerts;
}
