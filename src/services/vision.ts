import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env';
import { ocrImage } from './typhoon';
import { getD1 } from '../db/client';
import { logEvent } from '../db/events';

/** Best-effort event logging that never breaks extraction. */
function tryLog(level: 'info' | 'warn' | 'error', event: string, detail: string): void {
  try {
    logEvent(getD1(), level, 'ai', event, detail);
  } catch {
    /* database not bound (local dev) — skip */
  }
}

export interface SlipExtractionResult {
  is_slip: boolean;
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  merchant: string | null;
  direction: 'income' | 'expense' | null; // null when the slip does not clearly show money in vs out
  category: string | null; // best-fit category name, normalized by the webhook
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

Your job is to examine the provided slip (as OCR text, an image, or both) and extract information into a strictly formatted JSON object:
{
  "is_slip": boolean,
  "amount": number | null,
  "date": "YYYY-MM-DD" | null,
  "merchant": string | null,
  "direction": "income" | "expense" | null,
  "category": string | null,
  "confidence": "high" | "medium" | "low"
}

Rules:
1. "is_slip":
   - Set to true ONLY if the input is a valid bank transfer slip, payment confirmation, or purchase receipt.
   - Set to false if it is anything else (e.g. memes, cat/dog photos, landscapes, selfies, arbitrary text/screenshots).
2. "amount":
   - The final transferred or paid amount in Thai Baht (numeric float/integer, no commas or currency symbols).
   - If not found or not a slip, set to null.
3. "date":
   - The transaction date formatted as "YYYY-MM-DD".
   - Note: Thai slips often use Buddhist Era (พ.ศ.), e.g., 2567 -> 2024, 2568 -> 2025. Convert any Buddhist year to Gregorian year (AD = BE - 543).
   - The date must never be in the future. If the date cannot be determined, set to null.
4. "merchant":
   - The recipient name, store name, or merchant name (e.g. "นายสมชาย", "7-Eleven", "GrabFood").
   - If unclear or not found, set to null.
5. "direction":
   - Decide who RECEIVES and who SENDS the money on the slip, then classify the account holder's perspective:
   - "expense": money going OUT — outgoing transfer confirmations, bill payments, QR payments, withdrawals, purchase receipts (คำที่พบบ่อย: "โอนเงิน/โอนสำเร็จ", "จ่ายเงิน", "ชำระเงิน/ชำระบิล", "ถอนเงิน", "payment").
   - "income": money coming IN — receive/credit screens where the account holder is the RECIPIENT (คำที่พบบ่อย: "เงินเข้า", "รับเงิน/รับโอน", "เครดิต", หน้าจอ PromptPay ที่แสดงว่าเป็นผู้รับเงิน).
   - Direction of the arrow matters: FROM someone TO the account holder = "income"; FROM the account holder TO someone = "expense".
   - A merchant payment receipt (ใบเสร็จ/สลิปร้านค้า) is always "expense".
   - Set null ONLY when the input genuinely makes it impossible to tell.
6. "category":
   - Classify the transaction into EXACTLY ONE of these category names (verbatim Thai):
   - For "expense": "อาหารและเครื่องดื่ม" (food/drink/restaurant/cafe/groceries), "การเดินทาง" (fuel/toll/parking/taxi/bus/train/delivery fee), "ของใช้ทั่วไป" (household/personal items/clothes/medicine), "บิลและสาธารณูปโภค" (utility bills/phone/internet/insurance/rent), "อื่นๆ" (anything else).
   - For "income": "เงินเดือน" (salary), "ขายของ" (sales), "รายรับทั่วไป" (transfers received/refunds/other income), "อื่นๆ".
   - Use hints from the merchant name and slip type; when truly ambiguous use "อื่นๆ".
   - If not a slip, set to null.
7. "confidence":
   - "high": Clear slip, all fields unambiguous.
   - "medium": Some fields slightly unclear.
   - "low": Input is very unclear, partially cropped, or is not a slip.

Examples:
Input OCR: "รับโอนพร้อมเพย์ จำนวนเงิน 350.00 บาท วันที่ 15 มิ.ย. 2568 รับจาก นายสมชาย"
Output: {"is_slip": true, "amount": 350, "date": "2025-06-15", "merchant": "นายสมชาย", "direction": "income", "category": "รายรับทั่วไป", "confidence": "high"}
Input OCR: "ร้านข้าวแกงคุณหนู ยอดรวม 129.00 บาท 20/09/2568"
Output: {"is_slip": true, "amount": 129, "date": "2025-09-20", "merchant": "ร้านข้าวแกงคุณหนู", "direction": "expense", "category": "อาหารและเครื่องดื่ม", "confidence": "high"}
Input OCR: "แมวส้มอ้วน น่ารักมาก" (from a meme photo)
Output: {"is_slip": false, "amount": null, "date": null, "merchant": null, "direction": null, "category": null, "confidence": "low"}

8. Output MUST be ONLY valid raw JSON without markdown code fences (\`\`\`json) and no conversational text.`;

/**
 * Structured-output contract. With responseSchema the API guarantees the exact
 * JSON shape, eliminating malformed-output retries.
 */
const SLIP_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_slip: { type: Type.BOOLEAN },
    amount: { type: Type.NUMBER, nullable: true },
    date: { type: Type.STRING, nullable: true },
    merchant: { type: Type.STRING, nullable: true },
    direction: { type: Type.STRING, enum: ['income', 'expense'], nullable: true },
    category: { type: Type.STRING, nullable: true },
    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] }
  },
  required: ['is_slip', 'amount', 'date', 'merchant', 'direction', 'category', 'confidence'],
  propertyOrdering: ['is_slip', 'amount', 'date', 'merchant', 'direction', 'category', 'confidence']
};

/**
 * Numbers sitting next to a currency marker (บาท/THB/฿) are the most
 * trustworthy amount on a Thai slip.
 */
function bahtMarkedAmounts(text: string): number[] {
  const amounts: number[] = [];
  const re = /(?:฿\s*(\d[\d,]*(?:\.\d{1,2})?))|((\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|THB))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] ?? m[2];
    if (raw) amounts.push(parseFloat(raw.replace(/,/g, '')));
  }
  return amounts;
}

/**
 * Post-validation against the OCR text: corrects hallucinated amounts and
 * rejects future dates. Mutates `result` in place.
 */
function postValidate(result: SlipExtractionResult, ocrText: string | null): void {
  if (result.is_slip && result.amount !== null && ocrText) {
    const bahts = bahtMarkedAmounts(ocrText);
    const llmAmount = result.amount;
    if (bahts.length > 0 && !bahts.some(a => Math.abs(a - llmAmount) < 0.005)) {
      const unique = [...new Set(bahts)];
      if (unique.length === 1) {
        // Exactly one baht-marked number on the slip — trust the OCR over the LLM
        result.amount = unique[0];
        tryLog('warn', 'amount_crosscheck_fix', `llm=${llmAmount} ocr=${unique[0]}`);
      } else {
        // Multiple candidates and none match — keep the LLM value but flag it
        result.confidence = 'low';
        tryLog('warn', 'amount_crosscheck_mismatch', `llm=${llmAmount} ocr=${unique.join('|')}`);
      }
    }
  }
  if (result.date) {
    const ts = new Date(`${result.date}T00:00:00Z`).getTime();
    // 2 days of slack covers the Bangkok (UTC+7) day boundary
    if (isNaN(ts) || ts > Date.now() + 2 * 24 * 60 * 60 * 1000) {
      tryLog('warn', 'future_date_rejected', result.date);
      result.date = null;
    }
  }
}

/**
 * OCR text that smells like a Thai payment slip. Used as a safety net: when
 * Gemini rules the text-only pass "not a slip" but the text looks like one,
 * we retry once with the actual image attached.
 */
const SLIP_HINT_RE =
  /(โอน|พร้อมเพย์|promptpay|เงินเข้า|รับเงิน|ชำระเงิน|ชำระบิล|จ่ายเงิน|จำนวนเงิน|ยอดรวม|รวมทั้งสิ้น|เงินออก|เงินสด|ธนาคาร|kbank|scb|ktb|bbl|bay|ttb|truewallet|prompt pay|transfer|payment)/i;

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
    category: null,
    confidence: 'low'
  };

  const client = clientOverride || getGeminiClient();
  const model = config.gemini.model;

  // Stage 1 (optional): Typhoon OCR reads the slip text — fast and Thai-accurate.
  // Its output is passed to Gemini for structuring into JSON.
  let ocrText: string | null = null;
  if (config.typhoon.apiKey) {
    const t0 = Date.now();
    try {
      ocrText = await ocrImage(imageBuffer, mimeType);
      // Privacy-safe stats: Thai character ratio and how many slip keywords the
      // text contains — enough to spot mojibake / wrong-image OCR without
      // logging slip contents.
      const thaiChars = (ocrText.match(/[\u0E00-\u0E7F]/g) || []).length;
      const hintCount = (ocrText.match(new RegExp(SLIP_HINT_RE.source, 'gi')) || []).length;
      tryLog('info', 'typhoon_ocr_stats', `latency=${Date.now() - t0}ms chars=${ocrText.length} thai=${(thaiChars / ocrText.length).toFixed(2)} hints=${hintCount}`);
    } catch (err: any) {
      // Non-fatal: fall back to Gemini reading the image directly
      tryLog('warn', 'typhoon_ocr_fail', String(err?.message || err));
    }
  }

  // When OCR succeeded we structure TEXT ONLY — no image upload, several
  // seconds faster per slip. The image goes to Gemini only when OCR failed
  // or when the text-only pass misses an obvious slip (retry below).
  const userPrompt = ocrText
    ? `The OCR text below was extracted from a photo the user just sent. Analyze whether that photo is a payment slip, transfer confirmation, or purchase receipt, using the OCR text as the evidence:\n"""\n${ocrText}\n"""\nJudge ONLY from what the text says — do NOT answer is_slip=false merely because no image is attached to this message. If the text contains transaction details (amounts, transfer/payment wording, dates, bank or merchant names), it IS a slip or receipt. Output the transaction details as JSON.`
    : 'Analyze this image and output the transaction details as JSON.';

  const textParts = [{ text: userPrompt }];
  const imageParts = [
    { inlineData: { mimeType: mimeType, data: imageBuffer.toString('base64') } },
    { text: 'Analyze this image and output the transaction details as JSON.' }
  ];
  let parts: any[] = ocrText ? textParts : imageParts;

  const MAX_RETRIES = 3;
  let lastError: any;
  // thinkingBudget 0 disables thinking — much faster for straight extraction.
  // Negative values mean "leave the model default" and skip the config entirely.
  let applyThinking = config.gemini.thinkingBudget >= 0;
  let usedImageFallback = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const requestConfig: any = {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: SLIP_RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(15_000)
      };
      if (applyThinking) {
        requestConfig.thinkingConfig = { thinkingBudget: config.gemini.thinkingBudget };
      }

      const response = await client.models.generateContent({
        model: model,
        contents: [
          {
            role: 'user',
            parts
          }
        ],
        config: requestConfig
      });

      let textContent = response.text || '';
      if (!textContent) return fallbackResult;

      // Strip markdown code fences in case the model ignores responseMimeType
      textContent = textContent.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

      const parsed = JSON.parse(textContent);
      const result: SlipExtractionResult = {
        is_slip: Boolean(parsed.is_slip),
        amount: typeof parsed.amount === 'number' ? parsed.amount : (parsed.amount ? parseFloat(parsed.amount) : null),
        date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
        merchant: parsed.merchant ? String(parsed.merchant).trim() : null,
        direction: parsed.direction === 'income' || parsed.direction === 'expense' ? parsed.direction : null,
        category: parsed.category && typeof parsed.category === 'string' ? parsed.category.trim() : null,
        confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low'
      };

      postValidate(result, ocrText);

      // Safety net: the text-only pass sometimes misjudges a real slip as
      // "not a slip" (e.g. OCR wording the hint regex misses). Whenever the
      // text pass says no, retry once with the actual image attached — the
      // model reading the photo directly is far more reliable. Does not
      // consume an error retry.
      if (!result.is_slip && ocrText && !usedImageFallback) {
        usedImageFallback = true;
        parts = imageParts;
        tryLog('warn', 'not_slip_disagrees_with_ocr', 'retrying with image attached');
        attempt--;
        continue;
      }

      return result;
    } catch (error: any) {
      lastError = error;
      // Models without thinking support reject the config — drop it and retry
      // without consuming an attempt
      if (applyThinking && error?.status === 400 && /thinking/i.test(String(error?.message || ''))) {
        applyThinking = false;
        attempt--;
        continue;
      }
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
