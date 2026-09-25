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

    const viaHeader = await handleAdminApi(
      new Request('https://x.test/api/admin/overview', { headers: { 'x-admin-key': 'secret-admin-key-123' } }),
      makeUrl()
    );
    expect(viaHeader.status).toBe(200);
  });
});
