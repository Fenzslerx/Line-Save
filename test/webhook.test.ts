import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { config } from '../src/config/env';
import { replyLineMessage, downloadMessageImage } from '../src/services/line';
import { extractSlipInfo } from '../src/services/vision';
import { getD1 } from '../src/db/client';
import { findCategoryRule } from '../src/db/liff';

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
          all: jest.fn().mockResolvedValue({ results: rows, success: true }),
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

// The user-taught category rules come from the LIFF module — mocked so the
// auto-save flow is deterministic; specific tests override the return value.
jest.mock('../src/db/liff', () => ({
  findCategoryRule: jest.fn().mockResolvedValue(null),
  updateTransaction: jest.fn().mockResolvedValue(true)
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
    direction: 'expense',
    category: 'อาหารและเครื่องดื่ม',
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

  function makeImageEvent(messageId: string, replyToken: string, source: any) {
    return {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: { type: 'image', id: messageId },
          timestamp: 1625097605000,
          source,
          replyToken,
          mode: 'active'
        }
      ]
    };
  }

  async function postWebhook(payload: any) {
    const rawBody = JSON.stringify(payload);
    const signature = calculateSignature(rawBody, testSecret);
    return request(app)
      .post('/webhook')
      .set('x-line-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);
  }

  it('should return 401 when x-line-signature header is missing', async () => {
    const res = await request(app).post('/webhook').send({ events: [] });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('should return 401 when x-line-signature is invalid', async () => {
    const res = await request(app)
      .post('/webhook')
      .set('x-line-signature', 'invalid_signature_hash')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ events: [] }));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('should accept valid user event with correct signature', async () => {
    const userEventPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'message',
          message: { type: 'text', id: '325708', text: 'สรุป' },
          timestamp: 1625097600000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: '0f377ba0337f43769f6e07dd95ab0f7e',
          mode: 'active'
        }
      ]
    };

    const logSpy = jest.spyOn(console, 'log');
    const res = await postWebhook(userEventPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', processed: 1 });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Event] id=msg-325708'));
    logSpy.mockRestore();
  });

  it('should auto-save a slip and reply with the auto-saved card + single LIFF button', async () => {
    config.liffId = 'TEST_LIFF_ID';
    const callsBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook(makeImageEvent('325709', '1f377ba0337f43769f6e07dd95ab0f7f', {
      type: 'group', groupId: 'C_TEST_GROUP_001', userId: 'U_TEST_USER_002'
    }));

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, callsBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[callsBefore][1][0];
    const flexJson = JSON.stringify(flex);

    // Saved automatically with the LLM's category
    expect(flexJson).toContain('อาหารและเครื่องดื่ม');
    expect(flexJson).toContain('GrabFood');
    // Header shows expense sign and amount
    expect(flexJson).toContain('−฿500');
    // Exactly one LIFF button plus the type-toggle postback button
    const buttons = JSON.stringify(flex).match(/"type":"uri"/g) || [];
    expect(buttons).toHaveLength(1);
    expect(flexJson).toContain('https://liff.line.me/TEST_LIFF_ID');
    // The type-toggle postback lets the user flip income <-> expense
    expect(flexJson).toContain('act=toggle_type&tx=');
  });

  it('should prefer a user-taught category rule over the LLM guess', async () => {
    (findCategoryRule as jest.Mock).mockResolvedValueOnce({ category: 'กาแฟ', type: 'expense' });
    const callsBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook(makeImageEvent('325801', '8f377ba0337f43769f6e07dd95ab0f7f', {
      type: 'user', userId: 'U_TEST_USER_001'
    }));

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, callsBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[callsBefore][1][0];
    expect(JSON.stringify(flex)).toContain('กาแฟ');
  });

  it('should fall back to อื่นๆ when the LLM category is unrecognizable', async () => {
    (extractSlipInfo as jest.Mock).mockResolvedValueOnce({
      is_slip: true, amount: 99, date: null, merchant: 'Mystery Shop',
      direction: 'expense', category: 'some unknown label', confidence: 'low'
    });
    const callsBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook(makeImageEvent('325802', '9f377ba0337f43769f6e07dd95ab0f7f', {
      type: 'user', userId: 'U_TEST_USER_001'
    }));

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, callsBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[callsBefore][1][0];
    expect(JSON.stringify(flex)).toContain('อื่นๆ');
  });

  it('should record an incoming-money slip as income and show + sign', async () => {
    (extractSlipInfo as jest.Mock).mockResolvedValueOnce({
      is_slip: true, amount: 1000, date: '2026-09-25', merchant: 'นายสมชาย',
      direction: 'income', category: 'รายรับทั่วไป', confidence: 'high'
    });

    const callsBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook(makeImageEvent('325710', '3f377ba0337f43769f6e07dd95ab0f7b', {
      type: 'user', userId: 'U_TEST_USER_001'
    }));

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, callsBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[callsBefore][1][0];
    const flexJson = JSON.stringify(flex);
    expect(flexJson).toContain('+฿1,000');
    expect(flexJson).toContain('รายรับ');
    // income category from the LLM was used, not an expense one
    expect(flexJson).toContain('รายรับทั่วไป');
  });

  it('should stay completely silent for a non-slip image', async () => {
    (extractSlipInfo as jest.Mock).mockResolvedValueOnce({
      is_slip: false, amount: null, date: null, merchant: null,
      direction: null, category: null, confidence: 'low'
    });

    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook(makeImageEvent('325803', 'af377ba0337f43769f6e07dd95ab0f7f', {
      type: 'user', userId: 'U_TEST_USER_001'
    }));

    expect(res.status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect((replyLineMessage as jest.Mock).mock.calls.length).toBe(repliesBefore);
  });

  it('should ignore unrecognized postback events', async () => {
    const postbackPayload = {
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'postback',
          postback: { data: JSON.stringify({ action: 'select_category', category: 'อาหาร' }) },
          timestamp: 1625097610000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: '2f377ba0337f43769f6e07dd95ab0f7a',
          mode: 'active'
        }
      ]
    };

    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook(postbackPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', processed: 1 });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((replyLineMessage as jest.Mock).mock.calls.length).toBe(repliesBefore);
  });

  it('should show the duplicate-slip warning card instead of double-saving', async () => {
    const dupRow = {
      id: 'TX_DUP_1', type: 'expense', category: 'อาหารและเครื่องดื่ม',
      amount: 500, merchant: 'GrabFood', date: '2026-09-23', source: 'line-bot'
    };
    (getD1 as jest.Mock)
      .mockReturnValueOnce(makeMockD1([])) // request log handle
      .mockReturnValueOnce(makeMockD1([])) // auto-record user
      .mockReturnValueOnce(makeMockD1([], { U_TEST: [dupRow] })); // msg/img lookups miss, content dedup hits

    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook(makeImageEvent('326000', 'bf377ba0337f43769f6e07dd95ab0f7f', {
      type: 'user', userId: 'U_TEST_USER_001'
    }));

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, repliesBefore + 1);

    const flex = (replyLineMessage as jest.Mock).mock.calls[repliesBefore][1][0];
    const flexJson = JSON.stringify(flex);
    expect(flexJson).toContain('บันทึกไว้แล้ว');
    expect(flexJson).toContain('act=dup_save&msg=326000');
    expect(flexJson).toContain('act=dup_skip&msg=326000');
    // Must NOT have auto-saved the slip again
    expect(flexJson).not.toContain('บันทึกรายจ่ายแล้ว');
  });

  it('should flip a transaction to income via the toggle_type postback', async () => {
    const txRow = {
      id: 'TX_TOGGLE_1', user_id: 'U_TEST_USER_001', group_id: null, type: 'expense',
      category: 'อาหารและเครื่องดื่ม', amount: 500, merchant: 'GrabFood', date: '2026-09-23'
    };
    (getD1 as jest.Mock)
      .mockReturnValueOnce(makeMockD1([])) // request log handle
      .mockReturnValueOnce(makeMockD1([])) // auto-record user
      .mockReturnValueOnce(makeMockD1([], { U_TEST: [txRow] })); // getTransactionById finds it

    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const res = await postWebhook({
      destination: 'U1234567890abcdef',
      events: [
        {
          type: 'postback',
          postback: { data: 'act=toggle_type&tx=TX_TOGGLE_1' },
          timestamp: 1625097611000,
          source: { type: 'user', userId: 'U_TEST_USER_001' },
          replyToken: 'cf377ba0337f43769f6e07dd95ab0f7a',
          mode: 'active'
        }
      ]
    });

    expect(res.status).toBe(200);
    await waitForMockCalls(replyLineMessage as jest.Mock, repliesBefore + 1);

    const { updateTransaction } = jest.requireMock('../src/db/liff');
    expect(updateTransaction).toHaveBeenCalledWith(
      expect.anything(), 'U_TEST_USER_001', 'TX_TOGGLE_1',
      expect.objectContaining({ type: 'income', category: 'รายรับทั่วไป' })
    );
    // A fresh saved card is re-sent: income header is green and the toggle
    // button now offers flipping back to expense
    const flex = (replyLineMessage as jest.Mock).mock.calls[repliesBefore][1][0];
    const flexJson = JSON.stringify(flex);
    expect(flexJson).toContain('#0E9F6E');
    expect(flexJson).toContain('บันทึกรายรับแล้ว');
    expect(flexJson).toContain('สลับเป็นรายจ่าย');
  });

  it('should return 200 for health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('should skip a slip message that was already processed (LINE redelivery)', async () => {
    const cached = {
      is_slip: true, amount: 500, date: '2026-09-23', merchant: 'GrabFood',
      direction: 'expense', category: 'อาหารและเครื่องดื่ม', confidence: 'high'
    };
    (getD1 as jest.Mock)
      .mockReturnValueOnce(makeMockD1([])) // first call: request log handle
      .mockReturnValueOnce(makeMockD1([])) // second call: auto-record user
      .mockReturnValueOnce(makeMockD1([{ result_json: JSON.stringify(cached) }])); // msg dedup lookup finds it

    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;
    const downloadsBefore = (downloadMessageImage as jest.Mock).mock.calls.length;

    const res = await postWebhook(makeImageEvent('325799', '6f377ba0337f43769f6e07dd95ab0f7e', {
      type: 'user', userId: 'U_TEST_USER_001'
    }));

    expect(res.status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 150));

    // Nothing must have been re-downloaded or re-answered for the duplicate
    expect((downloadMessageImage as jest.Mock).mock.calls.length).toBe(downloadsBefore);
    expect((replyLineMessage as jest.Mock).mock.calls.length).toBe(repliesBefore);
  });

  it('should answer a duplicate slip image instantly from cache without calling the LLM', async () => {
    const cached = {
      is_slip: true, amount: 777, date: '2026-09-23', merchant: '7-Eleven',
      direction: 'expense', category: 'ของใช้ทั่วไป', confidence: 'high'
    };
    (getD1 as jest.Mock)
      .mockReturnValueOnce(makeMockD1([])) // first call: request log handle
      .mockReturnValueOnce(makeMockD1([])) // second call: auto-record user
      .mockReturnValueOnce(
        makeMockD1([], { 'img:': [{ result_json: JSON.stringify(cached) }] }) // msg dedup misses, image cache hits
      );

    const visionCallsBefore = (extractSlipInfo as jest.Mock).mock.calls.length;
    const repliesBefore = (replyLineMessage as jest.Mock).mock.calls.length;

    const res = await postWebhook(makeImageEvent('325800', '7f377ba0337f43769f6e07dd95ab0f7f', {
      type: 'user', userId: 'U_TEST_USER_001'
    }));

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
      .mockReturnValueOnce(customD1) // first call: request log handle
      .mockReturnValueOnce(customD1) // second call: auto-record user
      .mockReturnValueOnce(customD1); // third call: summary command

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
    const res = await postWebhook(summaryPayload);

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
