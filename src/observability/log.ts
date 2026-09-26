/**
 * Observability helpers: correlation IDs, structured request logging,
 * slip-pipeline checkpoints and the audit trail.
 *
 * Privacy (PDPA): the LINE userId is never written to logs in full — only a
 * salted hash. Slip contents (names, account numbers) are never logged;
 * only metadata (amount, bank-ish category, confidence, latencies).
 */
import crypto from 'crypto';
import { D1Database } from '../db/client';
import { config } from '../config/env';
import { logEvent } from '../db/events';

/** Deterministic salted hash of a LINE userId — stable across requests, never reversible without the channel secret. */
export function hashUserId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const salt = config.line.channelSecret || 'linesave-unsalted';
  return crypto.createHmac('sha256', salt).update(String(userId)).digest('hex').slice(0, 16);
}

/** Correlation ID for one webhook event, derived from the LINE message/event id. */
export function newRequestId(event: any): string {
  const messageId = event?.message?.id;
  if (messageId) return `msg-${messageId}`;
  const nonce = crypto.randomBytes(6).toString('hex');
  return `evt-${event?.timestamp || Date.now()}-${nonce}`;
}

export type RequestOutcome = 'processing' | 'success' | 'failed' | 'ignored';

export interface RequestStartInfo {
  requestId: string;
  eventType: string;
  messageId?: string | null;
  userId?: string | null;
  groupId?: string | null;
}

/** Insert the request_logs row (outcome='processing'). Never throws. */
export function startRequest(db: D1Database | null | undefined, info: RequestStartInfo): void {
  if (!db) return;
  db.prepare(
    `INSERT INTO request_logs (request_id, ts, event_type, user_hash, group_id, message_id, outcome)
     VALUES (?, ?, ?, ?, ?, ?, 'processing')
     ON CONFLICT(request_id) DO NOTHING`
  )
    .bind(
      info.requestId,
      Math.floor(Date.now() / 1000),
      info.eventType,
      hashUserId(info.userId),
      info.groupId ?? null,
      info.messageId ?? null
    )
    .run()
    .catch(() => {});
}

/** Close the request_logs row with a final outcome and total latency. */
export function finishRequest(
  db: D1Database | null | undefined,
  requestId: string,
  outcome: RequestOutcome,
  latencyMs: number,
  error?: string | null
): Promise<void> {
  if (!db) return Promise.resolve();
  // Returned for awaiting — on Workers, un-awaited writes are dropped when
  // the handler settles, which leaves request rows stuck on 'processing'.
  return db
    .prepare('UPDATE request_logs SET outcome = ?, latency_ms = ?, error = ? WHERE request_id = ?')
    .bind(outcome, Math.round(latencyMs), error ? String(error).slice(0, 500) : null, requestId)
    .run()
    .then(() => undefined)
    .catch(() => {});
}

export type SlipStage =
  | 'received'
  | 'downloading'
  | 'extracting'
  | 'extracted'
  | 'awaiting_confirm'
  | 'saving'
  | 'saved'
  | 'replied'
  | 'not_slip'
  | 'skipped';

/**
 * Slip pipeline checkpoint — upsert into pending_slips. A row stuck in
 * 'pending' past a few minutes means the pipeline broke mid-way for that slip.
 */
export function setSlipStage(
  db: D1Database | null | undefined,
  messageId: string,
  stage: SlipStage,
  status: 'pending' | 'done' | 'failed' = 'pending',
  userId?: string | null
): Promise<void> {
  if (!db) return Promise.resolve();
  const now = Math.floor(Date.now() / 1000);
  // Returned for awaiting — a checkpoint write dropped by the Workers runtime
  // would leave the slip stuck 'pending' forever, which is exactly the state
  // this table exists to detect.
  return db
    .prepare(
      `INSERT INTO pending_slips (message_id, ts, updated_ts, user_hash, stage, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET updated_ts = excluded.updated_ts, stage = excluded.stage, status = excluded.status`
    )
    .bind(messageId, now, now, hashUserId(userId), stage, status)
    .run()
    .then(() => undefined)
    .catch(() => {});
}

/** Structured stage log: one line per pipeline step, all sharing the request_id. */
export function logStage(
  db: D1Database | null | undefined,
  requestId: string,
  stage: string,
  data?: Record<string, unknown>,
  level: 'info' | 'warn' | 'error' = 'info',
  latencyMs?: number
): void {
  logEvent(db, level, 'bot', `stage_${stage}`, null, {
    requestId,
    latencyMs,
    data
  });
}

/** Audit trail entry for data mutations (LIFF/admin). Never throws. */
export function audit(
  db: D1Database | null | undefined,
  actor: string,
  action: 'create' | 'update' | 'delete' | 'set',
  entity: 'transaction' | 'budget' | 'category_rule' | 'nickname',
  entityId?: string | null,
  detail?: Record<string, unknown>
): void {
  if (!db) return;
  db.prepare(
    'INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(
      Math.floor(Date.now() / 1000),
      actor,
      action,
      entity,
      entityId ?? null,
      detail ? JSON.stringify(detail) : null
    )
    .run()
    .catch(() => {});
  logEvent(db, 'info', 'liff', 'audit', `${action} ${entity} ${entityId ?? ''}`);
}

/** Drop slip checkpoints older than 7 days — housekeeping, call opportunistically. */
export function cleanupOldSlipTracking(db: D1Database | null | undefined): void {
  if (!db) return;
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  db.prepare('DELETE FROM pending_slips WHERE updated_ts < ?').bind(cutoff).run().catch(() => {});
}
