import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env';

export interface SlipExtractionResult {
  is_slip: boolean;
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  merchant: string | null;
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
5. "confidence":
   - "high": Clear slip, sharp image, all fields unambiguous.
   - "medium": Readable but some fields slightly unclear or blurry.
   - "low": Image is very blurry, corrupted, partially cropped, or is not a slip.
6. Output MUST be ONLY valid raw JSON without markdown code fences (\`\`\`json) and no conversational text.`;

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
    confidence: 'low'
  };

  try {
    const client = clientOverride || getGeminiClient();
    const base64Data = imageBuffer.toString('base64');
    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

    const response = await client.models.generateContent({
      model: model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: 'Analyze this image and output the transaction details as JSON.'
            }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
      }
    });

    const textContent = response.text || '';
    if (!textContent) {
      return fallbackResult;
    }

    const parsed = JSON.parse(textContent);

    return {
      is_slip: Boolean(parsed.is_slip),
      amount: typeof parsed.amount === 'number' ? parsed.amount : (parsed.amount ? parseFloat(parsed.amount) : null),
      date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      merchant: parsed.merchant ? String(parsed.merchant).trim() : null,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low'
    };
  } catch (error) {
    console.error('[Vision Service] Error analyzing slip image:', error);
    return fallbackResult;
  }
}
