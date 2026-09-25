import {
  createAutoSavedFlex,
  createSummaryFlex
} from '../src/templates/flex';
import { config } from '../src/config/env';

describe('Flex Message Templates', () => {
  beforeAll(() => {
    config.liffId = 'TEST_LIFF_ID';
  });

  it('should generate an auto-saved expense card with a single LIFF button', () => {
    const flex = createAutoSavedFlex({
      amount: 450,
      merchant: 'GrabFood',
      date: '2026-09-25',
      type: 'expense',
      category: 'อาหารและเครื่องดื่ม'
    });

    expect(flex.type).toBe('flex');
    expect(flex.altText).toContain('฿450');
    expect(flex.contents.type).toBe('bubble');

    const bubble = flex.contents as any;
    const bodyJson = JSON.stringify(bubble.body);
    expect(bodyJson).toContain('อาหารและเครื่องดื่ม');
    expect(bodyJson).toContain('GrabFood');

    // Exactly one button: opens the LIFF dashboard
    const buttons = collectButtons(bubble);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].action.type).toBe('uri');
    expect(buttons[0].action.uri).toBe('https://liff.line.me/TEST_LIFF_ID');
    expect(buttons[0].action.label).toContain('ดูรายการ');

    // No interactive postbacks anywhere — fully automatic flow
    expect(JSON.stringify(flex)).not.toContain('postback');
    // Expense sign shown
    expect(JSON.stringify(bubble.header)).toContain('−฿450');
  });

  it('should generate an auto-saved income card with + sign and income type row', () => {
    const flex = createAutoSavedFlex({
      amount: 1000,
      merchant: 'นายสมชาย',
      date: '2026-09-25',
      type: 'income',
      category: 'รายรับทั่วไป'
    });

    const bubble = flex.contents as any;
    expect(JSON.stringify(bubble.header)).toContain('+฿1,000');
    expect(JSON.stringify(bubble.body)).toContain('รายรับ');

    const buttons = collectButtons(bubble);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].action.type).toBe('uri');
  });

  it('should omit the LIFF button when LIFF_ID is not configured', () => {
    config.liffId = '';
    const flex = createAutoSavedFlex({
      amount: 250,
      merchant: null,
      date: '2026-09-25',
      type: 'expense',
      category: 'อื่นๆ'
    });
    const bubble = flex.contents as any;
    expect(collectButtons(bubble)).toHaveLength(0);
    expect(JSON.stringify(bubble.body)).toContain('ไม่ระบุ');
    config.liffId = 'TEST_LIFF_ID';
  });

  // Helper: collect every button inside the bubble
  function collectButtons(bubble: any): any[] {
    const buttons: any[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node.type === 'button' && node.action) {
        buttons.push(node);
      }
      for (const key of ['contents', 'header', 'body', 'footer']) {
        if (node[key]) walk(node[key]);
      }
    };
    walk(bubble);
    return buttons;
  }

  it('should generate Summary Flex Message with member breakdown for groups', () => {
    const flex = createSummaryFlex({
      periodLabel: 'ก.ย. 2569',
      totalExpense: 13000,
      categoryBreakdown: [
        { category: 'อาหาร', total_amount: 8000, transaction_count: 10 },
        { category: 'ของใช้', total_amount: 5000, transaction_count: 4 }
      ],
      memberBreakdown: [
        { nickname: 'ฟ้า', total_paid: 8000, transaction_count: 8 },
        { nickname: 'เจ', total_paid: 5000, transaction_count: 6 }
      ]
    });

    expect(flex.type).toBe('flex');
    expect(flex.altText).toContain('฿13,000');
    const bubble = flex.contents as any;
    expect(bubble.header).toBeDefined();

    const bodyJson = JSON.stringify(bubble.body);
    expect(bodyJson).toContain('ฟ้า');
    expect(bodyJson).toContain('เจ');
    expect(bodyJson).toContain('อาหาร');
  });

  it('should show income total as its own section in the Summary Flex Message', () => {
    const flex = createSummaryFlex({
      periodLabel: 'ก.ย. 2569',
      totalExpense: 500,
      totalIncome: 900,
      categoryBreakdown: [
        { category: 'อาหาร', total_amount: 500, transaction_count: 2 }
      ]
    });

    const bubble = flex.contents as any;
    const bodyJson = JSON.stringify(bubble.body);
    expect(bodyJson).toContain('รายรับ');
    expect(bodyJson).toContain('900');
  });
});
