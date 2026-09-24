import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { config } from '../src/config/env';
import { replyLineMessage, downloadMessageImage } from '../src/services/line';
import { extractSlipInfo } from '../src/services/vision';
import { getD1 } from '../src/db/client';

// Minimal fake of the D1 API: prepare(sql).bind(...).run()/all()
// firstByParamPrefix lets a test decide which queries appear to find a cached row,
// e.g. { 'img:': [{ result_json: '...' }] } makes only image-hash lookups hit.
function makeMockD1(selectRows: any[] = [], firstByParamPrefix?: Record<string, any[]>) {
  return {
    prepare: jest.fn((sql: string) => ({
      bind: jest.fn((...params: any[]) => {
        const p0 = String(params[0] ?? '');
        const prefixMap = firstByParamPrefix;
        const prefixMatch = prefixMap ? Object.keys(prefixMap).find(k => p0.startsWith(k)) : undefined;
        const rows = prefixMatch && prefixMap ? prefixMap[prefixMatch] : selectRows;
        return {
          run: jest.fn().mockResolvedValue({ success: true }),
          all: jest.fn().mockResolvedValue({ results: selectRows, success: true }),
          first: jest.fn().mockResolvedValue(rows[0] ?? null)
        };
      }),
      run: jest.fn().mockResolvedValue({ success: true }),
      all: jest.fn().mockResolvedValue({ results: selectRows, success: true }),
      first: jest.fn().mockResolvedValue(selectRows[0] ?? null)
    }))
  };
}

jest.mock('../src/db/client', () => ({
  getD1: jest.fn(),
  setD1Database: jest.fn()
}));

// Wait for the background event processing (fired after the 200 response) to reach a mock
async function waitForMockCalls(mock: jest.Mock, minCalls: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mock.mock.calls.length >= minCalls) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Mock was not called ${minCalls} time(s) within ${timeoutMs}ms`);
}

function collectPostbackButtons(bubble: any): any[] {
  const buttons: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'button' && node.action?.type === 'postback') {
      buttons.push(node);
    }
    for (const key of ['contents', 'header', 'body', 'footer']) {
      if (node[key]) walk(node[key]);
    }
  };
  walk(bubble);
  return buttons;
}

function makeMockSupabase(rpcData: any[]) {
  return makeMockD1(rpcData);
}

// Mock external services so tests don't make real network calls
jest.mock('../src/services/line', () => ({
  downloadMessageImage: jest.fn().mockResolvedValue(Buffer.from('mock_image')),
  replyLineMessage: jest.fn().mockResolvedValue(undefined),
  showLoadingAnimation: jest.fn().mockResolvedValue(undefined)
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

describe('LINE Webhook Endpoint (POST /webhook)', () => {
  const app = createApp();
  const testSecret = 'test_channel_secret_12345';

  beforeAll(() => {
    config.line.channelSecret = testSecret;
    (getD1 as jest.Mock).mockImplementation(() => makeMockD1([
      { category: 'อาหาร', type: 'expense', total_amount: 500, transaction_count: 1 }
    ]));
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

  it('should record an incoming-money slip as income, not expense', async () => {
    (extractSlipInfo as jest.Mock).mockResolvedValueOnce({
      is_slip: true,
      amount: 1000,
      date: '2026-09-25',
      merchant: 'นายสมชาย',
      direction: 'income',
      confidence: 'high'
    });

    const imageEventPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: { type: 'image', id: '325710' },
          timestamp: 1625097620000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: '3f377ba0337f43769f6e07dd95ab0f7b',
          mode: 'active'
        }
      ]
    };

    const callsBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const rawBody = JSON.stringify(imageEventPayload);
    const signature = calculateSignature(rawBody, testSecret);
    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, callsBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[callsBefore][1][0];
    const buttons = collectPostbackButtons(flex.contents);
    const categoryButtons = buttons
      .map((b: any) => JSON.parse(b.action.data))
      .filter((d: any) => d.action === 'select_category');

    expect(categoryButtons.length).toBeGreaterThan(0);
    for (const d of categoryButtons) {
      expect(d.tx.type).toBe('income');
    }
  });

  it('should re-render the category card when the user switches transaction type', async () => {
    const switchPostbackPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'postback',
          postback: {
            data: JSON.stringify({
              action: 'switch_type',
              tx: {
                userId: 'U_TEST_USER_001',
                groupId: null,
                amount: 350,
                date: '2026-09-25',
                merchant: 'KFC',
                type: 'income'
              }
            })
          },
          timestamp: 1625097630000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: '4f377ba0337f43769f6e07dd95ab0f7c',
          mode: 'active'
        }
      ]
    };

    const callsBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const rawBody = JSON.stringify(switchPostbackPayload);
    const signature = calculateSignature(rawBody, testSecret);
    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, callsBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[callsBefore][1][0];
    const bodyJson = JSON.stringify(flex.contents.body);
    // The re-rendered card must offer income categories with income-typed save buttons
    expect(bodyJson).toContain('เงินเดือน');
    const buttons = collectPostbackButtons(flex.contents);
    const categoryButtons = buttons
      .map((b: any) => JSON.parse(b.action.data))
      .filter((d: any) => d.action === 'select_category');
    expect(categoryButtons.length).toBeGreaterThan(0);
    for (const d of categoryButtons) {
      expect(d.tx.type).toBe('income');
    }
  });

  it('should skip a slip message that was already processed (LINE redelivery)', async () => {
    const cached = {
      is_slip: true,
      amount: 500,
      date: '2026-09-23',
      merchant: 'GrabFood',
      direction: 'expense',
      confidence: 'high'
    };
    (getD1 as jest.Mock)
      .mockReturnValueOnce(makeMockD1([])) // first call: auto-record user
      .mockReturnValueOnce(makeMockD1([{ result_json: JSON.stringify(cached) }])); // msg dedup lookup finds it

    const imageEventPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: { type: 'image', id: '325799' },
          timestamp: 1625097650000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: '6f377ba0337f43769f6e07dd95ab0f7e',
          mode: 'active'
        }
      ]
    };

    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const downloadsBefore = (downloadMessageImage as jest.Mock).mock.calls.length;

    const rawBody = JSON.stringify(imageEventPayload);
    const signature = calculateSignature(rawBody, testSecret);
    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 150));

    // Nothing must have been re-downloaded or re-answered for the duplicate
    expect((downloadMessageImage as jest.Mock).mock.calls.length).toBe(downloadsBefore);
    expect((replyLineMessage as jest.Mock).mock.calls.length).toBe(repliesBefore);
  });

  it('should answer a duplicate slip image instantly from cache without calling the LLM', async () => {
    const cached = {
      is_slip: true,
      amount: 777,
      date: '2026-09-23',
      merchant: '7-Eleven',
      direction: 'expense',
      confidence: 'high'
    };
    (getD1 as jest.Mock)
      .mockReturnValueOnce(makeMockD1([])) // first call: auto-record user
      .mockReturnValueOnce(
        makeMockD1([], { 'img:': [{ result_json: JSON.stringify(cached) }] }) // msg dedup misses, image cache hits
      );

    const imageEventPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: { type: 'image', id: '325800' },
          timestamp: 1625097660000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: '7f377ba0337f43769f6e07dd95ab0f7f',
          mode: 'active'
        }
      ]
    };

    const visionCallsBefore = (extractSlipInfo as jest.Mock).mock.calls.length;
    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;

    const rawBody = JSON.stringify(imageEventPayload);
    const signature = calculateSignature(rawBody, testSecret);
    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, repliesBefore + 1);

    expect((extractSlipInfo as jest.Mock).mock.calls.length).toBe(visionCallsBefore);
    const flex = (replyLineMessage as jest.Mock).mock.calls[repliesBefore][1][0];
    expect(JSON.stringify(flex)).toContain('777');
  });

  it('should keep income out of the expense category breakdown and show it separately', async () => {
    const customD1 = makeMockD1([
      { category: 'อาหาร', type: 'expense', total_amount: 500, transaction_count: 2 },
      { category: 'เงินเดือน', type: 'income', total_amount: 900, transaction_count: 1 }
    ]);
    (getD1 as jest.Mock)
      .mockReturnValueOnce(customD1) // first call: auto-record user
      .mockReturnValueOnce(customD1); // second call: summary command

    const summaryPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: { type: 'text', id: '325711', text: 'สรุป' },
          timestamp: 1625097640000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: '5f377ba0337f43769f6e07dd95ab0f7d',
          mode: 'active'
        }
      ]
    };

    const callsBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const rawBody = JSON.stringify(summaryPayload);
    const signature = calculateSignature(rawBody, testSecret);
    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, callsBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[callsBefore][1][0];
    const bodyJson = JSON.stringify(flex.contents.body);

    // Income rows must not appear inside the expense category breakdown
    expect(bodyJson).not.toContain('เงินเดือน');
    // Income must be displayed as its own section
    expect(bodyJson).toContain('รายรับ');
    // Header total stays expense-only
    expect(flex.altText).toContain('฿500');
  });
});
