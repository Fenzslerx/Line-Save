import { logEvent, getEventCounts, getRecentEvents, getAiUsage } from '../src/db/events';

function makeFakeD1(rows: any[] = [], firstRow: any = null) {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      const state = { sql, params: [] as any[] };
      return {
        bind(...params: any[]) {
          state.params = params;
          return this;
        },
        async run() {
          calls.push({ sql: state.sql, params: state.params });
          return { success: true };
        },
        async all() {
          calls.push({ sql: state.sql, params: state.params });
          return { results: rows, success: true };
        },
        async first() {
          calls.push({ sql: state.sql, params: state.params });
          return firstRow;
        }
      };
    }
  } as any;
}

describe('System event log', () => {
  it('should insert an event with a unix timestamp', async () => {
    const db = makeFakeD1();
    logEvent(db, 'error', 'ai', 'gemini_call_fail', 'boom');
    const { sql, params } = db.calls[0];
    expect(sql).toContain('INSERT INTO system_events');
    expect(params[1]).toBe('error');
    expect(params[2]).toBe('ai');
    expect(params[3]).toBe('gemini_call_fail');
    expect(params[4]).toBe('boom');
    expect(params[0]).toBeGreaterThan(1_700_000_000);
  });

  it('should silently skip logging when no database is bound', () => {
    expect(() => logEvent(null, 'info', 'bot', 'x')).not.toThrow();
    expect(() => logEvent(undefined, 'info', 'bot', 'x')).not.toThrow();
  });

  it('should count events by level within a window', async () => {
    const db = makeFakeD1([], { info: 10, warn: 2, error: 3 });
    const res = await getEventCounts(db, 60 * 60 * 24);
    expect(res).toEqual({ info: 10, warn: 2, error: 3 });
    expect(db.calls[0].sql).toContain("level = 'error'");
    expect(db.calls[0].params[0]).toBeGreaterThan(1_700_000_000);
  });

  it('should list recent events newest first, optionally by level', async () => {
    const db = makeFakeD1([{ ts: 1, level: 'error', source: 'bot', event: 'x', detail: null }]);
    const res = await getRecentEvents(db, 30, 'error');
    expect(db.calls[0].sql).toContain('WHERE level = ?');
    expect(res[0].event).toBe('x');
  });

  it('should aggregate AI usage by event name', async () => {
    const db = makeFakeD1([{ event: 'gemini_call_ok', count: 7, last_ts: 123 }]);
    const res = await getAiUsage(db);
    expect(db.calls[0].sql).toContain("source = 'ai'");
    expect(db.calls[0].sql).toContain('GROUP BY event');
    expect(res[0].count).toBe(7);
  });
});
