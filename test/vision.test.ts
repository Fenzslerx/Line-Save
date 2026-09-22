import { extractSlipInfo } from '../src/services/vision';

describe('Vision LLM Slip Extraction Service', () => {
  const dummyBuffer = Buffer.from('fake_image_bytes');

  it('should successfully parse a valid bank transfer slip', async () => {
    const mockAnthropic = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                is_slip: true,
                amount: 350.5,
                date: '2026-09-23',
                merchant: 'นายสมชาย ใจดี',
                confidence: 'high'
              })
            }
          ]
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockAnthropic);

    expect(result.is_slip).toBe(true);
    expect(result.amount).toBe(350.5);
    expect(result.date).toBe('2026-09-23');
    expect(result.merchant).toBe('นายสมชาย ใจดี');
    expect(result.confidence).toBe('high');
  });

  it('should correctly identify a non-slip image (e.g. cat photo)', async () => {
    const mockAnthropic = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                is_slip: false,
                amount: null,
                date: null,
                merchant: null,
                confidence: 'low'
              })
            }
          ]
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockAnthropic);

    expect(result.is_slip).toBe(false);
    expect(result.amount).toBeNull();
    expect(result.date).toBeNull();
    expect(result.merchant).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('should handle markdown fenced JSON returned by LLM', async () => {
    const mockAnthropic = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '```json\n{\n  "is_slip": true,\n  "amount": 1200,\n  "date": "2026-09-20",\n  "merchant": "ร้านอาหารตามสั่ง",\n  "confidence": "high"\n}\n```'
            }
          ]
        })
      }
    } as any;

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockAnthropic);

    expect(result.is_slip).toBe(true);
    expect(result.amount).toBe(1200);
    expect(result.merchant).toBe('ร้านอาหารตามสั่ง');
  });

  it('should gracefully fallback when response is malformed or unparseable', async () => {
    const mockAnthropic = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: 'Sorry, I could not process this image.'
            }
          ]
        })
      }
    } as any;

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockAnthropic);

    expect(result.is_slip).toBe(false);
    expect(result.amount).toBeNull();
    expect(result.confidence).toBe('low');

    consoleErrorSpy.mockRestore();
  });

  it('should gracefully handle API call failures', async () => {
    const mockAnthropic = {
      messages: {
        create: jest.fn().mockRejectedValue(new Error('Anthropic API rate limit exceeded'))
      }
    } as any;

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await extractSlipInfo(dummyBuffer, 'image/jpeg', mockAnthropic);

    expect(result.is_slip).toBe(false);
    expect(result.confidence).toBe('low');

    consoleErrorSpy.mockRestore();
  });
});
