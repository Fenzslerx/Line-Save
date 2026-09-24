import {
  createCategorySelectionFlex,
  createSummaryFlex,
  createConfirmedFlex
} from '../src/templates/flex';

describe('Flex Message Templates', () => {
  it('should generate valid Category Selection Flex Message', () => {
    const flex = createCategorySelectionFlex({
      amount: 450,
      merchant: 'GrabFood',
      date: '2026-09-23',
      transactionData: {
        userId: 'U12345',
        groupId: 'G9876',
        amount: 450,
        date: '2026-09-23',
        merchant: 'GrabFood',
        type: 'expense'
      }
    });

    expect(flex.type).toBe('flex');
    expect(flex.altText).toContain('฿450');
    expect(flex.contents.type).toBe('bubble');

    const bubble = flex.contents as any;
    expect(bubble.header).toBeDefined();
    expect(bubble.body).toBeDefined();

    // Check postback buttons
    const bodyContents = bubble.body.contents;
    const buttonBox = bodyContents[bodyContents.length - 1];
    expect(buttonBox.contents.length).toBeGreaterThan(0);

    const firstRow = buttonBox.contents[0];
    const firstButton = firstRow.contents[0];
    expect(firstButton.action.type).toBe('postback');
    const parsedData = JSON.parse(firstButton.action.data);
    expect(parsedData.action).toBe('select_category');
    expect(parsedData.tx.amount).toBe(450);
  });

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

  it('should generate Confirmed Flex Message', () => {
    const flex = createConfirmedFlex('อาหาร', 250, '7-Eleven');
    expect(flex.type).toBe('flex');
    expect(flex.altText).toContain('บันทึกเรียบร้อย');
    const json = JSON.stringify(flex);
    expect(json).toContain('อาหาร');
    expect(json).toContain('7-Eleven');
  });

  // Helper: collect every postback button inside the bubble
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

  it('should offer income categories for an income slip and a toggle back to expense', () => {
    const flex = createCategorySelectionFlex({
      amount: 1000,
      merchant: 'นายสมชาย',
      date: '2026-09-25',
      transactionData: {
        userId: 'U12345',
        groupId: null,
        amount: 1000,
        date: '2026-09-25',
        merchant: 'นายสมชาย',
        type: 'income'
      }
    });

    const bubble = flex.contents as any;
    const buttons = collectPostbackButtons(bubble);
    const categoryButtons = buttons
      .map(b => JSON.parse(b.action.data))
      .filter(d => d.action === 'select_category');

    // Income transaction must carry type income into every save button
    expect(categoryButtons.length).toBeGreaterThan(0);
    for (const d of categoryButtons) {
      expect(d.tx.type).toBe('income');
    }

    // Income categories offered, expense categories not
    const bodyJson = JSON.stringify(bubble.body);
    expect(bodyJson).toContain('เงินเดือน');
    expect(bodyJson).toContain('กรุณาเลือกหมวดหมู่รายรับ');
    expect(bodyJson).not.toContain('อาหาร');

    // A toggle to switch the record back to expense
    const switchButtons = buttons
      .map(b => JSON.parse(b.action.data))
      .filter(d => d.action === 'switch_type');
    expect(switchButtons).toHaveLength(1);
    expect(switchButtons[0].tx.type).toBe('expense');
    expect(switchButtons[0].tx.amount).toBe(1000);
  });

  it('should keep expense categories for an expense slip and offer a toggle to income', () => {
    const flex = createCategorySelectionFlex({
      amount: 450,
      merchant: 'GrabFood',
      date: '2026-09-25',
      transactionData: {
        userId: 'U12345',
        groupId: null,
        amount: 450,
        date: '2026-09-25',
        merchant: 'GrabFood',
        type: 'expense'
      }
    });

    const bubble = flex.contents as any;
    const buttons = collectPostbackButtons(bubble);
    const categoryButtons = buttons
      .map(b => JSON.parse(b.action.data))
      .filter(d => d.action === 'select_category');

    expect(categoryButtons.length).toBeGreaterThan(0);
    for (const d of categoryButtons) {
      expect(d.tx.type).toBe('expense');
    }

    const switchButtons = buttons
      .map(b => JSON.parse(b.action.data))
      .filter(d => d.action === 'switch_type');
    expect(switchButtons).toHaveLength(1);
    expect(switchButtons[0].tx.type).toBe('income');
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
