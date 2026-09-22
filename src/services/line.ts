import { messagingApi } from '@line/bot-sdk';
import { config } from '../config/env';

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
  const blobClient = getLineBlobClient();
  const stream = await blobClient.getMessageContent(messageId);

  // Convert Node.js readable stream / web stream to Buffer
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Reply message helper
 */
export async function replyLineMessage(replyToken: string, messages: any[]): Promise<void> {
  const client = getLineClient();
  await client.replyMessage({
    replyToken,
    messages
  });
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
    console.warn('[LINE API] Failed to show loading animation:', err);
  }
}
