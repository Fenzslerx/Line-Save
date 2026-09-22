import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { config } from '../src/config/env';

// Mock external services so tests don't make real network calls
jest.mock('../src/services/line', () => ({
  downloadMessageImage: jest.fn().mockResolvedValue(Buffer.from('mock_image')),
  replyLineMessage: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/services/vision', () => ({
  extractSlipInfo: jest.fn().mockResolvedValue({
    is_slip: true,
    amount: 500,
    date: '2026-09-23',
    merchant: 'GrabFood',
    confidence: 'high'
  })
}));

jest.mock('../src/db/client', () => ({
  getSupabaseClient: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      upsert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: {}, error: null })
        })
      }),
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: {}, error: null })
        })
      })
    }),
    rpc: jest.fn().mockResolvedValue({
      data: [{ category: 'อาหาร', total_amount: 500, transaction_count: 1, type: 'expense' }],
      error: null
    })
  })
}));

describe('LINE Webhook Endpoint (POST /webhook)', () => {
  const app = createApp();
  const testSecret = 'test_channel_secret_12345';

  beforeAll(() => {
    config.line.channelSecret = testSecret;
    config.supabase.url = 'https://mock.supabase.co';
    config.supabase.serviceKey = 'mock_key';
  });

  function calculateSignature(body: string, secret: string): string {
    return crypto.createHmac('SHA256', secret).update(body).digest('base64');
  }

  it('should return 401 when x-line-signature header is missing', async () => {
    const payload = { events: [] };
    const res = await request(app)
      .post('/webhook')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('should return 401 when x-line-signature is invalid', async () => {
    const payload = JSON.stringify({ events: [] });
    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', 'invalid_signature_hash')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('should accept valid user event with correct signature', async () => {
    const userEventPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: {
            type: 'text',
            id: '325708',
            text: 'สรุป'
          },
          timestamp: 1625097600000,
          source: {
            type: 'user',
            userId: 'U_TEST_USER_001'
          },
          replyToken: '0f377ba0337f43769f6e07dd95ab0f7e',
          mode: 'active'
        }
      ]
    };

    const rawBody = JSON.stringify(userEventPayload);
    const signature = calculateSignature(rawBody, testSecret);

    const logSpy = jest.spyOn(console, 'log');

    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', processed: 1 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Mode: 1-on-1 Chat]'));

    logSpy.mockRestore();
  });

  it('should accept valid group event with correct signature and log group mode', async () => {
    const groupEventPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: {
            type: 'image',
            id: '325709',
            contentProvider: {
              type: 'line'
            }
          },
          timestamp: 1625097605000,
          source: {
            type: 'group',
            groupId: 'C_TEST_GROUP_001',
            userId: 'U_TEST_USER_002'
          },
          replyToken: '1f377ba0337f43769f6e07dd95ab0f7f',
          mode: 'active'
        }
      ]
    };

    const rawBody = JSON.stringify(groupEventPayload);
    const signature = calculateSignature(rawBody, testSecret);

    const logSpy = jest.spyOn(console, 'log');

    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', processed: 1 });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Mode: Group/Room] Handling event in group: C_TEST_GROUP_001 from user: U_TEST_USER_002')
    );

    logSpy.mockRestore();
  });

  it('should process postback category selection and save transaction', async () => {
    const postbackPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'postback',
          postback: {
            data: JSON.stringify({
              action: 'select_category',
              category: 'อาหาร',
              tx: {
                userId: 'U_TEST_USER_001',
                groupId: null,
                amount: 350,
                date: '2026-09-23',
                merchant: 'KFC',
                type: 'expense'
              }
            })
          },
          timestamp: 1625097610000,
          source: {
            type: 'user',
            userId: 'U_TEST_USER_001'
          },
          replyToken: '2f377ba0337f43769f6e07dd95ab0f7a',
          mode: 'active'
        }
      ]
    };

    const rawBody = JSON.stringify(postbackPayload);
    const signature = calculateSignature(rawBody, testSecret);

    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', processed: 1 });
  });

  it('should return 200 for health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
