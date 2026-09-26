import crypto from 'crypto';
import { config } from '../src/config/env';
import { hashUserId, newRequestId, startRequest, finishRequest, setSlipStage, logStage, audit } from '../src/observability/log';
import { getSlipMetrics, getWebhookLatency } from '../src/db/metrics';

/**
 * Minimal fake of the Cloudflare D1 API surface (see db.test.ts).
 */
function makeFakeD1(rows: any[] = []) {
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
          return rows[0] ?? null;
        }
      };
    }
  } as any;
}

describe('Observability', () => {
  beforeAll(() => {
    config.line.channelSecret = 'test-secret';
  });

  describe('hashUserId (PDPA)', () => {
    it('should hash the userId deterministically and never store it raw', () => {
      const h1 = hashUserId('U123abc');
      const h2 = hashUserId('U123abc');
      expect(h1).toBe(h2);
      expect(h1).not.toContain('U123abc');
      expect(h1).toHaveLength(16);
    });

    it('should produce different hashes for different users', () => {
      expect(hashUserId('U111')).not.toBe(hashUserId('U222'));
    });

    it('should return null for missing userId', () => {
      expect(hashUserId(null)).toBeNull();
      expect(hashUserId('')).toBeNull();
    });

    it('should change the hash when the salt (channel secret) changes', () => {
      const before = hashUserId('U123abc');
      config.line.channelSecret = 'other-secret';
      const after = hashUserId('U123abc');
      config.line.channelSecret = 'test-secret';
      expect(before).not.toBe(after);
    });
  });

  describe('newRequestId (correlation ID)', () => {
    it('should use the message id so every stage shares one ID', () => {
      const id = newRequestId({ message: { id: '325709' } });
      expect(id).toBe('msg-325709');
    });

    it('should fall back to a generated ID for events without a message', () => {
      const id = newRequestId({ type: 'follow', timestamp: 123 });
      expect(id).toMatch(/^evt-123-/);
    });
  });

  describe('request_logs', () => {
    it('should start a request with outcome processing and a hashed user', () => {
      const db = makeFakeD1();
      startRequest(db, {
        requestId: 'msg-1',
        eventType: 'message.image',
        messageId: '1',
        userId: 'U123abc',
        groupId: 'G1'
      });
      expect(db.calls[0].sql).toContain('INSERT INTO request_logs');
      expect(db.calls[0].params).toContain('message.image');
      const userHash = db.calls[0].params[3];
      expect(userHash).not.toContain('U123abc');
    });

    it('should finish a request with outcome, latency and error', () => {
      const db = makeFakeD1();
      finishRequest(db, 'msg-1', 'failed', 1234, 'boom');
      expect(db.calls[0].sql).toContain('UPDATE request_logs SET outcome');
      expect(db.calls[0].params).toEqual(['failed', 1234, 'boom', 'msg-1']);
    });
  });

  describe('pending_slips (slip pipeline checkpoints)', () => {
    it('should upsert stage transitions', () => {
      const db = makeFakeD1();
      setSlipStage(db, 'm1', 'received', 'pending', 'U123abc');
      setSlipStage(db, 'm1', 'saved', 'done', 'U123abc');
      expect(db.calls).toHaveLength(2);
      expect(db.calls[0].sql).toContain('INSERT INTO pending_slips');
      expect(db.calls[1].params[4]).toBe('saved');
      expect(db.calls[1].params[5]).toBe('done');
    });
  });

  describe('structured stage + audit logs', () => {
    it('should emit stage logs carrying the requestId as JSON', () => {
      const db = makeFakeD1();
      logStage(db, 'msg-9', 'slip_saved', { type: 'expense', amount: 500 });
      const call = db.calls[0];
      expect(call.sql).toContain('request_id');
      expect(call.params).toContain('msg-9');
      expect(JSON.parse(call.params[7])).toMatchObject({ amount: 500 });
    });

    it('should write audit rows for mutations', () => {
      const db = makeFakeD1();
      audit(db, 'U123abc', 'delete', 'transaction', '42');
      expect(db.calls[0].sql).toContain('INSERT INTO audit_log');
      expect(db.calls[0].params.slice(1, 5)).toEqual(['U123abc', 'delete', 'transaction', '42']);
    });
  });

  describe('metrics', () => {
    it('should aggregate slip outcomes including stuck pipelines and not-slip verdicts', async () => {
      const db = makeFakeD1([
        { total: 10, success: 7, failed: 1, ignored: 1, stuck: 1 },
        { not_slip: 1, not_slip_1h: 0 }
      ]);
      const m = await getSlipMetrics(db);
      expect(m).toEqual({ total: 10, success: 7, failed: 1, ignored: 1, stuck: 1, not_slip: 1, not_slip_1h: 0 });
    });

    it('should compute webhook latency percentiles', async () => {
      const latencies = Array.from({ length: 100 }, (_, i) => ({ l: i + 1 }));
      const db = makeFakeD1(latencies);
      const stats = await getWebhookLatency(db);
      expect(stats.samples).toBe(100);
      expect(stats.p50).toBe(50);
      expect(stats.p95).toBe(95);
    });
  });
});
