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
});
