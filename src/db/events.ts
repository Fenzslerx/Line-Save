import { D1Database } from './client';

export type EventLevel = 'info' | 'warn' | 'error';
export type EventSource = 'bot' | 'liff' | 'ai' | 'db' | 'system';

export interface SystemEventRow {
  ts: number;
  level: EventLevel;
  source: EventSource;
  event: string;
  detail: string | null;
}

/**
 * Fire-and-forget event logging — callers should not await this in the hot
 * path; failures to log must never break the bot.
 */
export function logEvent(
  db: D1Database | null | undefined,
  level: EventLevel,
  source: EventSource,
  event: string,
  detail?: string | null
): void {
  if (!db) return;
  db.prepare(
    'INSERT INTO system_events (ts, level, source, event, detail) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(Math.floor(Date.now() / 1000), level, source, event, detail ?? null)
    .run()
    .catch(() => {});
}

const DAY = 60 * 60 * 24;

/** Count of events grouped by level, within the given window. */
export async function getEventCounts(
  db: D1Database,
  windowSeconds: number = DAY
): Promise<{ info: number; warn: number; error: number }> {
  const cutoff = Math.floor(Date.now() / 1000) - windowSeconds;
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(level = 'info'), 0)  AS info,
         COALESCE(SUM(level = 'warn'), 0)  AS warn,
         COALESCE(SUM(level = 'error'), 0) AS error
       FROM system_events WHERE ts >= ?`
    )
    .bind(cutoff)
    .first();
  return {
    info: Number(row?.info ?? 0),
    warn: Number(row?.warn ?? 0),
    error: Number(row?.error ?? 0)
  };
}

/** Most recent events, newest first. When level is given only those are returned. */
export async function getRecentEvents(
  db: D1Database,
  limit = 40,
  level?: EventLevel
): Promise<SystemEventRow[]> {
  const { results } = level
    ? await db
        .prepare('SELECT ts, level, source, event, detail FROM system_events WHERE level = ? ORDER BY ts DESC LIMIT ?')
        .bind(level, limit)
        .all()
    : await db
        .prepare('SELECT ts, level, source, event, detail FROM system_events ORDER BY ts DESC LIMIT ?')
        .bind(limit)
        .all();
  return (results || []).map(r => ({
    ts: Number(r.ts),
    level: r.level as EventLevel,
    source: r.source as EventSource,
    event: String(r.event),
    detail: r.detail ?? null
  }));
}

/** AI call counters within the window, keyed by event name (e.g. gemini_call_ok). */
export async function getAiUsage(
  db: D1Database,
  windowSeconds: number = DAY
): Promise<{ event: string; count: number; last_ts: number }[]> {
  const cutoff = Math.floor(Date.now() / 1000) - windowSeconds;
  const { results } = await db
    .prepare(
      `SELECT event, COUNT(*) AS count, MAX(ts) AS last_ts
       FROM system_events WHERE source = 'ai' AND ts >= ?
       GROUP BY event ORDER BY count DESC`
    )
    .bind(cutoff)
    .all();
  return (results || []).map(r => ({
    event: String(r.event),
    count: Number(r.count),
    last_ts: Number(r.last_ts)
  }));
}
