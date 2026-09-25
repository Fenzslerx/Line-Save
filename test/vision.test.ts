import { extractSlipInfo } from '../src/services/vision';

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
