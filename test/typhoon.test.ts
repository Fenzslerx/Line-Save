import { ocrImage } from '../src/services/typhoon';
import { config } from '../src/config/env';

const dummyBuffer = Buffer.from('fake_image_bytes');

describe('Typhoon OCR Service', () => {
  beforeAll(() => {
    config.typhoon.apiKey = 'test_typhoon_key';
    config.typhoon.model = 'typhoon-ocr-v1.5';
  });

  it('should throw when the API key is missing', async () => {
    config.typhoon.apiKey = '';
    await expect(ocrImage(dummyBuffer)).rejects.toThrow('TYPHOON_API_KEY');
    config.typhoon.apiKey = 'test_typhoon_key';
  });

  it('should call the OpenAI-compatible endpoint and return the OCR text', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'ธนาคารกสิกรไทย\nโอนเงิน 500.00 บาท\nวันที่ 23/09/2568' } }] }),
      { status: 200 }
    ));
    global.fetch = fetchMock as any;

    const text = await ocrImage(dummyBuffer, 'image/jpeg');

    expect(text).toContain('โอนเงิน 500.00');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.opentyphoon.ai/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('typhoon-ocr-v1.5');
    expect(body.temperature).toBe(0);
    expect(body.messages[0].content[0].type).toBe('image_url');
    expect(body.messages[0].content[0].image_url.url).toContain('data:image/jpeg;base64,');
    expect(init.headers.authorization).toBe('Bearer test_typhoon_key');
  });

  it('should throw with the status code on API errors', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('rate limited', { status: 429 })) as any;
    await expect(ocrImage(dummyBuffer)).rejects.toThrow('Typhoon API 429');
  });

  it('should throw when the response contains no text', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [] }),
      { status: 200 }
    )) as any;
    await expect(ocrImage(dummyBuffer)).rejects.toThrow('empty response');
  });
});
