import { messagingApi } from '@line/bot-sdk';
import { config } from '../config/env';
import { getD1 } from '../db/client';
import { logEvent } from '../db/events';

/** Best-effort LINE API logging that never breaks the caller. */
function tryLog(level: 'info' | 'warn' | 'error', event: string, detail: string): void {
  try {
    logEvent(getD1(), level, 'line', event, detail);
  } catch {
    /* database not bound (local dev) — skip */
  }
}

let lineClient: messagingApi.MessagingApiClient | null = null;
let lineBlobClient: messagingApi.MessagingApiBlobClient | null = null;

export function getLineClient(): messagingApi.MessagingApiClient {
  if (!lineClient) {
    lineClient = new messagingApi.MessagingApiClient({
      channelAccessToken: config.line.channelAccessToken
    });
  }
  return lineClient;
}

export function getLineBlobClient(): messagingApi.MessagingApiBlobClient {
  if (!lineBlobClient) {
    lineBlobClient = new messagingApi.MessagingApiBlobClient({
      channelAccessToken: config.line.channelAccessToken
    });
  }
  return lineBlobClient;
}

/**
 * Downloads image content from LINE Messaging API for a given messageId
 */
export async function downloadMessageImage(messageId: string): Promise<Buffer> {
  const t0 = Date.now();
  try {
    const blobClient = getLineBlobClient();
    const stream = await blobClient.getMessageContent(messageId);

    // Convert Node.js readable stream / web stream to Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    tryLog('info', 'content_download_ok', `msg=${messageId} bytes=${Buffer.concat(chunks).length} latency=${Date.now() - t0}ms`);
    return Buffer.concat(chunks);
  } catch (err: any) {
    tryLog('error', 'content_download_fail', `msg=${messageId} status=${err?.status ?? '?'} ${String(err?.message || err).slice(0, 200)}`);
    throw err;
  }
}

/**
 * Reply message helper — logs every failure (invalid token, quota exceeded,
 * network) so reply outages are visible in the admin dashboard.
 */
export async function replyLineMessage(replyToken: string, messages: any[]): Promise<void> {
  const client = getLineClient();
  const t0 = Date.now();
  try {
    await client.replyMessage({
      replyToken,
      messages
    });
    tryLog('info', 'reply_ok', `messages=${messages.length} latency=${Date.now() - t0}ms`);
  } catch (err: any) {
    tryLog(
      'error',
      'reply_fail',
      `status=${err?.status ?? '?'} ${String(err?.message || err).slice(0, 200)}`
    );
    throw err;
  }
}

/**
 * Show loading animation (typing indicator)
 */
export async function showLoadingAnimation(chatId: string, loadingSeconds: number = 20): Promise<void> {
  try {
    const client = getLineClient();
    await client.showLoadingAnimation({
      chatId,
      loadingSeconds
    });
  } catch (err) {
    tryLog('warn', 'loading_fail', String((err as any)?.message || err).slice(0, 200));
    console.warn('[LINE API] Failed to show loading animation:', err);
  }
}
