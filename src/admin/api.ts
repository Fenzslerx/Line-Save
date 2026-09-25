import { getD1, checkDatabaseConnection } from '../db/client';
import { getEventCounts, getRecentEvents, getAiUsage } from '../db/events';
import { config } from '../config/env';

/**
 * Timing-safe comparison for the admin key.
 */
function keyMatches(provided: string): boolean {
  const expected = config.adminKey;
  if (!expected || !provided) return false;
  if (expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

function extractKey(request: Request, url: URL): string {
  const header = request.headers.get('x-admin-key');
  if (header) return header;
  return url.searchParams.get('key') || '';
}

/**
 * GET /api/admin/overview?key=... — everything the admin dashboard needs in one call:
 * service status, event counters, AI usage and recent errors.
 */
export async function handleAdminApi(request: Request, url: URL): Promise<Response> {
  if (!keyMatches(extractKey(request, url))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getD1();
  const [dbStatus, counts24h, counts7d, errors, ai24h, ai7d] = await Promise.all([
    checkDatabaseConnection(),
    getEventCounts(db, 60 * 60 * 24),
    getEventCounts(db, 7 * 60 * 60 * 24),
    getRecentEvents(db, 30, 'error'),
    getAiUsage(db, 60 * 60 * 24),
    getAiUsage(db, 7 * 60 * 60 * 24)
  ]);

  return Response.json({
    generated_at: new Date().toISOString(),
    services: {
      database: {
        ok: dbStatus.ok,
        message: dbStatus.message
      },
      ai: {
        provider: 'Google Gemini (Vision)',
        model: config.gemini.model,
        key_configured: Boolean(config.gemini.apiKey)
      },
      line: {
        secret_configured: Boolean(config.line.channelSecret),
        token_configured: Boolean(config.line.channelAccessToken)
      },
      liff: {
        id_configured: Boolean(config.liffId)
      }
    },
    counts24h,
    counts7d,
    ai24h,
    ai7d,
    recentErrors: errors
  });
}
