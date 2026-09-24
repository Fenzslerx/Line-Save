import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env';

export interface SlipExtractionResult {
  is_slip: boolean;
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  merchant: string | null;
  direction: 'income' | 'expense' | null; // null when the slip does not clearly show money in vs out
  confidence: 'high' | 'medium' | 'low';
}

let geminiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    if (!config.gemini.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables.');
    }
    geminiClient = new GoogleGenAI({
      apiKey: config.gemini.apiKey
    });
  }
  return geminiClient;
}

const SYSTEM_PROMPT = `You are an expert AI specializing in analyzing payment slips, bank transfer slips, and merchant receipts, primarily for Thai financial institutions (e.g. KBank, SCB, KTB, BBL, Krungsri, PromptPay, TrueMoney).

Your job is to examine the provided image and extract information into a strictly formatted JSON object:
{
  "is_slip": boolean,
  "amount": number | null,
  "date": "YYYY-MM-DD" | null,
  "merchant": string | null,
  "direction": "income" | "expense" | null,
  "confidence": "high" | "medium" | "low"
}

Rules:
1. "is_slip":
   - Set to true ONLY if the image is a valid bank transfer slip, payment confirmation, or purchase receipt.
   - Set to false if the image is anything else (e.g. memes, cat/dog photos, landscapes, selfies, arbitrary text/screenshots).
2. "amount":
   - The final transferred or paid amount in Thai Baht (numeric float/integer, no commas or currency symbols).
   - If not found or not a slip, set to null.
3. "date":
   - The transaction date formatted as "YYYY-MM-DD".
   - Note: Thai slips often use Buddhist Era (พ.ศ.), e.g., 2567 -> 2024, 2568 -> 2025. Convert any Buddhist year to Gregorian year (AD = BE - 543).
   - If the date cannot be determined, set to null.
4. "merchant":
   - The recipient name, store name, or merchant name (e.g. "นายสมชาย", "7-Eleven", "GrabFood").
   - If unclear or not found, set to null.
5. "direction":
   - Decide who RECEIVES and who SENDS the money on the slip, then classify the account holder's perspective:
   - "expense": money going OUT — outgoing transfer confirmations, bill payments, QR payments, withdrawals, purchase receipts (คำที่พบบ่อย: "โอนเงิน/โอนสำเร็จ", "จ่ายเงิน", "ชำระเงิน/ชำระบิล", "ถอนเงิน", "payment").
   - "income": money coming IN — receive/credit screens where the account holder is the RECIPIENT (คำที่พบบ่อย: "เงินเข้า", "รับเงิน/รับโอน", "เครดิต", หน้าจอ PromptPay ที่แสดงว่าเป็นผู้รับเงิน).
   - Direction of the arrow matters: FROM someone TO the account holder = "income"; FROM the account holder TO someone = "expense".
   - A merchant payment receipt (ใบเสร็จ/สลิปร้านค้า) is always "expense".
   - Set null ONLY when the image genuinely makes it impossible to tell.
6. "confidence":
   - "high": Clear slip, sharp image, all fields unambiguous.
   - "medium": Readable but some fields slightly unclear or blurry.
   - "low": Image is very blurry, corrupted, partially cropped, or is not a slip.
7. Output MUST be ONLY valid raw JSON without markdown code fences (\`\`\`json) and no conversational text.`;

/**
 * Extracts payment details from an image buffer using Google Gemini Vision
 */
export async function extractSlipInfo(
  imageBuffer: Buffer,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg',
  clientOverride?: GoogleGenAI
): Promise<SlipExtractionResult> {
  const fallbackResult: SlipExtractionResult = {
    is_slip: false,
    amount: null,
    date: null,
    merchant: null,
    direction: null,
    confidence: 'low'
  };

  const client = clientOverride || getGeminiClient();
  const base64Data = imageBuffer.toString('base64');
  const model = config.gemini.model;

  const MAX_RETRIES = 3;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: model,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mimeType, data: base64Data } },
              { text: 'Analyze this image and output the transaction details as JSON.' }
            ]
          }
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          maxOutputTokens: 1024
        }
      });

      let textContent = response.text || '';
      if (!textContent) return fallbackResult;

      // Strip markdown code fences in case the model ignores responseMimeType
      textContent = textContent.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

      const parsed = JSON.parse(textContent);
      return {
        is_slip: Boolean(parsed.is_slip),
        amount: typeof parsed.amount === 'number' ? parsed.amount : (parsed.amount ? parseFloat(parsed.amount) : null),
        date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
        merchant: parsed.merchant ? String(parsed.merchant).trim() : null,
        direction: parsed.direction === 'income' || parsed.direction === 'expense' ? parsed.direction : null,
        confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low'
      };
    } catch (error: any) {
      lastError = error;
      // Retry on 5xx, rate limits, or JSON parsing errors (SyntaxError)
      const isRetryable = error?.status === 503 || error?.status === 500 || error?.status === 429 || error instanceof SyntaxError;
      if (isRetryable && attempt < MAX_RETRIES) {
        console.warn(`[Vision Service] Attempt ${attempt} failed: ${error.message}. Retrying in 0.8s...`);
        await new Promise(resolve => setTimeout(resolve, 800));
      } else {
        break; // Stop retrying
      }
    }
  }

  console.error('[Vision Service] Error analyzing slip image after retries:', lastError);
  return fallbackResult;
}
