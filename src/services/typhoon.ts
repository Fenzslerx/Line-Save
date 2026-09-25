import { config } from '../config/env';

/**
 * Thai-optimized OCR via the SCB 10X Typhoon API (OpenAI-compatible endpoint).
 * Typhoon reads Thai payment slips very accurately and fast; its raw text
 * output is fed to Gemini to structure into JSON.
 */

const OCR_PROMPT =
  'Extract ALL text visible in this payment slip image, in the original Thai and English. ' +
  'Preserve every number, amount, date, account name, bank name, and reference exactly as shown. ' +
  'Output plain text only, no commentary.';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Runs OCR on a slip image. Throws on any failure — callers decide on fallback.
 */
export async function ocrImage(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  if (!config.typhoon.apiKey) {
    throw new Error('TYPHOON_API_KEY is not configured.');
  }

  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  const res = await fetch('https://api.opentyphoon.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.typhoon.apiKey}`
    },
    body: JSON.stringify({
      model: config.typhoon.model,
      temperature: 0,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: OCR_PROMPT }
          ]
        }
      ]
    }),
    // Short timeout: OCR is a latency optimization — if it is slow it defeats
    // its own purpose, and Gemini can still read the image directly.
    signal: AbortSignal.timeout(9_000)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Typhoon API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as ChatCompletionResponse;
  const text = json?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) {
    throw new Error('Typhoon OCR returned an empty response.');
  }
  return String(text).trim();
}
