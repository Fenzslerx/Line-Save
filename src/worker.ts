/**
 * Cloudflare Workers entrypoint.
 *
 * The Express server (src/index.ts) is used for local dev / Render deploys;
 * this handler exposes the same endpoints (/health, /webhook) on Workers so
 * the bot can also run on Cloudflare. Secrets are bound as Worker variables
 * (see wrangler.jsonc) and injected into the shared config on each request.
 */
import { initConfig, config } from './config/env';
import { processWebhookEvent } from './handlers/webhook';
import { setD1Database, D1Database } from './db/client';
import { logEvent } from './db/events';
import { handleLiffApi } from './liff/api';
import { renderLiffPage } from './liff/page';
import { renderAdminPage } from './admin/page';
import { handleAdminApi } from './admin/api';

/**
 * LINE webhook signature check using Web Crypto (available on Workers).
 * Mirrors verifySignature() in handlers/webhook.ts, which uses node:crypto.
 */
async function verifyLineSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    let binary = '';
    const bytes = new Uint8Array(mac);
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const expected = btoa(binary);

    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

interface WorkerEnv {
  DB?: D1Database;
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  LIFF_ID?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    initConfig(env as Record<string, string | undefined>);
    if (env.DB) {
      setD1Database(env.DB);
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      const body = url.pathname === '/'
        ? { status: 'ok', service: 'line-expense-bot', endpoints: { webhook: 'POST /webhook', health: 'GET /health', liff: 'GET /liff', api: '/api/liff/*' }, timestamp: new Date().toISOString() }
        : { status: 'ok', timestamp: new Date().toISOString() };
      return Response.json(body);
    }

    if (request.method === 'GET' && url.pathname === '/liff') {
      return new Response(renderLiffPage(env.LIFF_ID || ''), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    if (url.pathname.startsWith('/api/liff/')) {
      return handleLiffApi(request, url);
    }

    if (request.method === 'GET' && url.pathname === '/admin') {
      return new Response(renderAdminPage(), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdminApi(request, url);
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const rawBody = await request.text();
      const signature = request.headers.get('x-line-signature') || '';

      if (!(await verifyLineSignature(rawBody, signature, config.line.channelSecret))) {
        console.warn('[Webhook] Invalid or missing signature');
        logEvent(env.DB, 'warn', 'system', 'signature_invalid', 'worker: invalid or missing x-line-signature');
        return Response.json({ error: 'Invalid signature' }, { status: 401 });
      }

      let events: any[] = [];
      try {
        events = JSON.parse(rawBody)?.events || [];
      } catch {
        events = [];
      }

      // Acknowledge immediately so LINE does not time out, then keep processing
      // alive past the response via waitUntil.
      ctx.waitUntil(
        Promise.all(
          events.map(event =>
            processWebhookEvent(event).catch(err => {
              console.error('[Webhook Background] Error processing event:', err);
              logEvent(env.DB, 'error', 'bot', 'event_processing_error', String(err?.message || err));
            })
          )
        )
      );

      return Response.json({ status: 'ok', processed: events.length });
    }

    return new Response('Not Found', { status: 404 });
  }
};
