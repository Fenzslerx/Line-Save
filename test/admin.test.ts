import { handleAdminApi } from '../src/admin/api';
import { getD1 } from '../src/db/client';
import { config } from '../src/config/env';

jest.mock('../src/db/client', () => ({
  getD1: jest.fn(),
  checkDatabaseConnection: jest.fn().mockResolvedValue({ ok: true, message: 'ok' })
}));

jest.mock('../src/db/events', () => ({
  getEventCounts: jest.fn().mockResolvedValue({ info: 1, warn: 0, error: 0 }),
  getRecentEvents: jest.fn().mockResolvedValue([]),
  getAiUsage: jest.fn().mockResolvedValue([])
}));

jest.mock('../src/db/metrics', () => ({
  getSlipMetrics: jest.fn().mockResolvedValue({ total: 0, success: 0, failed: 0, ignored: 0, stuck: 0, not_slip: 0, not_slip_1h: 0 }),
  getWebhookLatency: jest.fn().mockResolvedValue({ p50: null, p95: null, samples: 0 }),
  getAiLatency: jest.fn().mockResolvedValue({ p50: null, p95: null, samples: 0 }),
  getOcrStats: jest.fn().mockResolvedValue({ ok: 0, fail: 0, failRate: 0, failRate1h: 0 }),
  getErrorsBySource: jest.fn().mockResolvedValue([]),
  getActiveUsers: jest.fn().mockResolvedValue(0),
  getReplyStats: jest.fn().mockResolvedValue({ ok: 0, fail: 0, successRate: 1 }),
  getSignatureFailures: jest.fn().mockResolvedValue(0),
  getPendingSlipCount: jest.fn().mockResolvedValue(0),
  getRecentAudit: jest.fn().mockResolvedValue([]),
  getAlerts: jest.fn().mockResolvedValue([]),
  getLiveFeed: jest.fn().mockResolvedValue({ now: 1, requests: [], events: [], slips: [] })
}));

function makeUrl(key?: string): URL {
  const u = new URL('https://x.test/api/admin/overview');
  if (key) u.searchParams.set('key', key);
  return u;
}

describe('Admin API', () => {
  beforeAll(() => {
    config.adminKey = 'secret-admin-key-123';
  });

  it('should reject requests without a valid key', async () => {
    const res = await handleAdminApi(new Request('https://x.test/api/admin/overview'), makeUrl());
    expect(res.status).toBe(401);

    const res2 = await handleAdminApi(new Request('https://x.test/api/admin/overview'), makeUrl('wrong'));
    expect(res2.status).toBe(401);
  });

  it('should accept a valid key via query or header and return the overview payload', async () => {
    (getD1 as jest.Mock).mockReturnValue({});

    const viaQuery = await handleAdminApi(new Request('https://x.test/api/admin/overview'), makeUrl('secret-admin-key-123'));
    expect(viaQuery.status).toBe(200);
    const body = await viaQuery.json();
    expect(body.services.ai.provider).toContain('Gemini');
    expect(body.counts24h.error).toBe(0);
    expect(Array.isArray(body.recentErrors)).toBe(true);
    expect(body.metrics.slips).toBeDefined();
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(Array.isArray(body.audit)).toBe(true);

    const viaHeader = await handleAdminApi(
      new Request('https://x.test/api/admin/overview', { headers: { 'x-admin-key': 'secret-admin-key-123' } }),
      makeUrl()
    );
    expect(viaHeader.status).toBe(200);
  });

  it('should serve the live activity feed behind the same key', async () => {
    const unauth = await handleAdminApi(
      new Request('https://x.test/api/admin/live'),
      new URL('https://x.test/api/admin/live')
    );
    expect(unauth.status).toBe(401);

    const liveUrl = new URL('https://x.test/api/admin/live');
    liveUrl.searchParams.set('key', 'secret-admin-key-123');
    const res = await handleAdminApi(new Request('https://x.test/api/admin/live'), liveUrl);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.now).toBeDefined();
    expect(Array.isArray(body.requests)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(Array.isArray(body.slips)).toBe(true);
  });
});
