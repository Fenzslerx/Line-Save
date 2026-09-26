import { extractSlipInfo } from '../src/services/vision';
import { config } from '../src/config/env';

describe('Vision LLM Slip Extraction Service (Gemini)', () => {
  const dummyBuffer = Buffer.from('fake_image_bytes');

  it('should successfully parse a valid bank transfer slip', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true,
            amount: 350.5,
            date: '2026-09-23',
            merchant: 'นายสมชาย ใจดี',
            confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.is_slip).toBe(true);
    expect(result.amount).toBe(350.5);
    expect(result.date).toBe('2026-09-23');
    expect(result.merchant).toBe('นายสมชาย ใจดี');
    expect(result.confidence).toBe('high');
  });

  it('should correctly identify a non-slip image (e.g. cat photo)', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: false,
            amount: null,
            date: null,
            merchant: null,
            confidence: 'low'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.is_slip).toBe(false);
    expect(result.amount).toBeNull();
    expect(result.date).toBeNull();
    expect(result.merchant).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('should handle markdown fenced JSON returned by LLM gracefully', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: '{\n  "is_slip": true,\n  "amount": 1200,\n  "date": "2026-09-20",\n  "merchant": "ร้านอาหารตามสั่ง",\n  "confidence": "high"\n}'
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.is_slip).toBe(true);
    expect(result.amount).toBe(1200);
    expect(result.merchant).toBe('ร้านอาหารตามสั่ง');
  });

  it('should gracefully fallback when response is malformed or unparseable', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: 'Sorry, I could not process this image.'
        })
      }
    } as any;

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.is_slip).toBe(false);
    expect(result.amount).toBeNull();
    expect(result.confidence).toBe('low');

    consoleErrorSpy.mockRestore();
  });

  it('should extract direction "income" for an incoming-transfer slip', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true,
            amount: 1000,
            date: '2026-09-25',
            merchant: 'นายสมชาย',
            direction: 'income',
            confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.is_slip).toBe(true);
    expect(result.direction).toBe('income');
  });

  it('should extract direction "expense" for an outgoing-payment slip', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true,
            amount: 250,
            date: '2026-09-25',
            merchant: '7-Eleven',
            direction: 'expense',
            confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.direction).toBe('expense');
  });

  it('should default direction to null when the model omits it', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true,
            amount: 250,
            date: '2026-09-25',
            merchant: '7-Eleven',
            confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.direction).toBeNull();
  });

  it('should extract the LLM-assigned category', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true,
            amount: 250,
            date: '2026-09-25',
            merchant: '7-Eleven',
            direction: 'expense',
            category: 'ของใช้ทั่วไป',
            confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);
    expect(result.category).toBe('ของใช้ทั่วไป');
  });

  it('should default category to null when the model omits it', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true,
            amount: 250,
            date: '2026-09-25',
            merchant: '7-Eleven',
            direction: 'expense',
            confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);
    expect(result.category).toBeNull();
  });

  it('should pass Typhoon OCR text to Gemini when the key is configured', async () => {
    config.typhoon.apiKey = 'test_typhoon_key';
    // No direction keyword in the text — the rule parser bails and Gemini takes over
    const fetchMock = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'KBank\nยอดเงิน 350.50 บาท\n23/09/2568 นายสมชาย' } }] }),
      { status: 200 }
    ));
    global.fetch = fetchMock as any;

    const promptSpy = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        is_slip: true, amount: 350.5, date: '2026-09-23',
        merchant: 'นายสมชาย', direction: 'expense',
        category: 'อาหารและเครื่องดื่ม', confidence: 'high'
      })
    });
    const mockGemini = { models: { generateContent: promptSpy } } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.amount).toBe(350.5);
    // The Gemini prompt must contain the Typhoon OCR output...
    const contents = promptSpy.mock.calls[0][0].contents;
    // ...as TEXT ONLY — no image part is attached when OCR succeeded
    expect(contents[0].parts).toHaveLength(1);
    const promptText = contents[0].parts[0].text;
    expect(promptText).toContain('OCR text below was extracted from a photo');
    expect(promptText).toContain('ยอดเงิน 350.50');
    expect(contents[0].parts[0].inlineData).toBeUndefined();
    // Deterministic extraction settings
    const requestConfig = promptSpy.mock.calls[0][0].config;
    expect(requestConfig.temperature).toBe(0);
    expect(requestConfig.responseSchema).toBeDefined();
    expect(requestConfig.abortSignal).toBeDefined();
    // OCR endpoint was actually called
    expect(fetchMock.mock.calls[0][0]).toContain('api.opentyphoon.ai');

    config.typhoon.apiKey = '';
    delete (global as any).fetch;
  });

  it('should skip Gemini entirely when the rule-based parser reads the OCR text', async () => {
    config.typhoon.apiKey = 'test_typhoon_key';
    const fetchMock = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'KBank\nโอนเงินสำเร็จ\nจำนวนเงิน 350.50 บาท\n23/09/2568' } }] }),
      { status: 200 }
    )) as any;
    global.fetch = fetchMock as any;

    const promptSpy = jest.fn();
    const mockGemini = { models: { generateContent: promptSpy } } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    // Templated Thai slips never reach the AI — zero quota usage
    expect(result.is_slip).toBe(true);
    expect(result.amount).toBe(350.5);
    expect(result.direction).toBe('expense');
    expect(result.date).toBe('2025-09-23');
    expect(promptSpy).not.toHaveBeenCalled();

    config.typhoon.apiKey = '';
    delete (global as any).fetch;
  });

  it('should attach the image when Typhoon OCR is not configured', async () => {
    config.typhoon.apiKey = '';
    const promptSpy = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        is_slip: true, amount: 100, date: '2026-09-23',
        merchant: '7-Eleven', direction: 'expense', category: 'ของใช้ทั่วไป', confidence: 'high'
      })
    });
    const mockGemini = { models: { generateContent: promptSpy } } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.amount).toBe(100);
    const parts = promptSpy.mock.calls[0][0].contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].inlineData.mimeType).toBe('image/jpeg');
  });

  it('should correct a hallucinated amount using the baht-marked number in OCR text', async () => {
    config.typhoon.apiKey = 'test_typhoon_key';
    global.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'KBank\nโอนเงินสำเร็จ\nจำนวนเงิน 1,250.00 บาท\n23/09/2568' } }] }),
      { status: 200 }
    )) as any;

    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true, amount: 999, date: '2026-09-23',
            merchant: 'KBank', direction: 'expense',
            category: 'อื่นๆ', confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    // The single baht-marked number on the slip wins over the LLM guess
    expect(result.amount).toBe(1250);

    config.typhoon.apiKey = '';
    delete (global as any).fetch;
  });

  it('should reject a date in the future', async () => {
    config.typhoon.apiKey = '';
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            is_slip: true, amount: 100, date: '2030-01-01',
            merchant: '7-Eleven', direction: 'expense', confidence: 'high'
          })
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.date).toBeNull();
  });

  it('should retry without thinkingConfig when the model rejects it', async () => {
    config.typhoon.apiKey = '';
    const thinkingError: any = new Error('thinkingConfig is not supported for this model');
    thinkingError.status = 400;
    const promptSpy = jest.fn()
      .mockRejectedValueOnce(thinkingError)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          is_slip: true, amount: 100, date: '2026-09-23',
          merchant: '7-Eleven', direction: 'expense', confidence: 'high'
        })
      });
    const mockGemini = { models: { generateContent: promptSpy } } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.amount).toBe(100);
    expect(promptSpy).toHaveBeenCalledTimes(2);
    expect(promptSpy.mock.calls[0][0].config.thinkingConfig).toBeDefined();
    expect(promptSpy.mock.calls[1][0].config.thinkingConfig).toBeUndefined();
  });

  it('should fall back to image-only Gemini when Typhoon OCR fails', async () => {
    config.typhoon.apiKey = 'test_typhoon_key';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;

    const promptSpy = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        is_slip: true, amount: 100, date: '2026-09-23',
        merchant: '7-Eleven', direction: 'expense', category: 'ของใช้ทั่วไป', confidence: 'high'
      })
    });
    const mockGemini = { models: { generateContent: promptSpy } } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.amount).toBe(100);
    const promptText = promptSpy.mock.calls[0][0].contents[0].parts[1].text;
    expect(promptText).not.toContain('OCR text extracted');
    warnSpy.mockRestore();
    config.typhoon.apiKey = '';
    delete (global as any).fetch;
  });

  it('should retry with the image attached when the text-only pass misses an obvious slip', async () => {
    config.typhoon.apiKey = 'test_typhoon_key';
    // Direction keywords present but no baht-marked amount — the rule parser
    // bails (no amount), so Gemini gets the text first and misses, then the
    // image fallback kicks in.
    global.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'KBank โอนเงินสำเร็จ ยืนยันรายการ 23/09/2568' } }] }),
      { status: 200 }
    )) as any;

    const notSlip = {
      text: JSON.stringify({
        is_slip: false, amount: null, date: null, merchant: null,
        direction: null, category: null, confidence: 'low'
      })
    };
    const slip = {
      text: JSON.stringify({
        is_slip: true, amount: 350.5, date: '2026-09-23', merchant: 'KBank',
        direction: 'expense', category: 'อื่นๆ', confidence: 'high'
      })
    };
    const promptSpy = jest.fn().mockResolvedValueOnce(notSlip).mockResolvedValueOnce(slip);
    const mockGemini = { models: { generateContent: promptSpy } } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.is_slip).toBe(true);
    expect(result.amount).toBe(350.5);
    expect(promptSpy).toHaveBeenCalledTimes(2);
    // First call: text-only. Second call: image attached as the fallback.
    expect(promptSpy.mock.calls[0][0].contents[0].parts).toHaveLength(1);
    expect(promptSpy.mock.calls[1][0].contents[0].parts[0].inlineData).toBeDefined();

    config.typhoon.apiKey = '';
    delete (global as any).fetch;
  });

  it('should gracefully handle API call failures', async () => {
    const mockGemini = {
      models: {
        generateContent: jest.fn().mockRejectedValue(new Error('Gemini API rate limit exceeded'))
      }
    } as any;

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockGemini);

    expect(result.is_slip).toBe(false);
    expect(result.confidence).toBe('low');

    consoleErrorSpy.mockRestore();
  });
});
