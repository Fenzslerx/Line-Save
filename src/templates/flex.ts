import { messagingApi } from '@line/bot-sdk';

export interface CategorySelectionData {
  amount: number;
  merchant: string | null;
  date: string;
  transactionData: {
    userId: string;
    groupId?: string | null;
    amount: number;
    date: string;
    merchant?: string | null;
    type: 'expense' | 'income';
  };
}

export interface SummaryData {
  periodLabel: string;
  totalExpense: number;
  totalIncome?: number;
  categoryBreakdown: { category: string; total_amount: number; transaction_count: number }[];
  memberBreakdown?: { nickname: string; total_paid: number; transaction_count: number }[];
}

/**
 * Creates Flex Message for selecting transaction category after slip is parsed
 */
export function createCategorySelectionFlex(data: CategorySelectionData): messagingApi.FlexMessage {
  const categories = [
    { label: '🍔 อาหาร', value: 'อาหาร', color: '#FF6B6B' },
    { label: '🚗 เดินทาง', value: 'เดินทาง', color: '#4D96FF' },
    { label: '🛒 ของใช้', value: 'ของใช้', color: '#6BCB77' },
    { label: '🎮 บันเทิง', value: 'บันเทิง', color: '#FFD93D' },
    { label: '💡 บิล/รายเดือน', value: 'บิล/ค่าใช้จ่ายประจำ', color: '#9B51E0' },
    { label: '📦 อื่นๆ', value: 'อื่นๆ', color: '#828282' }
  ];

  // Encode transaction details into postback data
  const basePostback = (cat: string) =>
    JSON.stringify({
      action: 'select_category',
      category: cat,
      tx: data.transactionData
    });

  // Group buttons into rows of 2
  const buttonRows: messagingApi.FlexBox[] = [];
  for (let i = 0; i < categories.length; i += 2) {
    const pair = categories.slice(i, i + 2);
    const rowButtons: messagingApi.FlexComponent[] = pair.map(cat => ({
      type: 'button',
      action: {
        type: 'postback',
        label: cat.label,
        data: basePostback(cat.value),
        displayText: `เลือกหมวด: ${cat.label}`
      },
      style: 'secondary',
      height: 'sm',
      margin: 'xs'
    }));

    buttonRows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: rowButtons
    });
  }

  return {
    type: 'flex',
    altText: `บันทึกสลิป: ฿${data.amount.toLocaleString()} - เลือกหมวดหมู่`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: '🧾 ตรวจพบสลิปโอนเงิน',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `฿${data.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            color: '#FFFFFF',
            weight: 'bold',
            size: 'xxl',
            margin: 'sm'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'ร้านค้า/ผู้รับ', size: 'sm', color: '#888888', flex: 3 },
                  {
                    type: 'text',
                    text: data.merchant || 'ไม่ระบุ',
                    size: 'sm',
                    color: '#111111',
                    weight: 'bold',
                    align: 'end',
                    flex: 5
                  }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'วันที่ทำรายการ', size: 'sm', color: '#888888', flex: 3 },
                  { type: 'text', text: data.date, size: 'sm', color: '#111111', align: 'end', flex: 5 }
                ]
              }
            ]
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'text',
            text: 'กรุณาเลือกหมวดหมู่ค่าใช้จ่าย:',
            size: 'sm',
            color: '#555555',
            weight: 'bold',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: buttonRows
          }
        ]
      }
    }
  };
}

/**
 * Creates Flex Message for financial expense summary
 */
export function createSummaryFlex(data: SummaryData): messagingApi.FlexMessage {
  const categoryContents: messagingApi.FlexComponent[] = data.categoryBreakdown.length > 0
    ? data.categoryBreakdown.map(item => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: item.category, size: 'sm', color: '#555555', flex: 4 },
          {
            type: 'text',
            text: `฿${Number(item.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
            size: 'sm',
            color: '#111111',
            align: 'end',
            weight: 'bold',
            flex: 4
          }
        ]
      }))
    : [{ type: 'text', text: 'ไม่มีรายการในช่วงเวลานี้', size: 'sm', color: '#888888' }];

  const memberBoxes: messagingApi.FlexComponent[] = [];
  if (data.memberBreakdown && data.memberBreakdown.length > 0) {
    memberBoxes.push(
      { type: 'separator', margin: 'lg' },
      {
        type: 'text',
        text: '👥 ยอดจ่ายแยกตามสมาชิก:',
        weight: 'bold',
        size: 'sm',
        color: '#333333',
        margin: 'md'
      }
    );

    for (const member of data.memberBreakdown) {
      memberBoxes.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: member.nickname, size: 'sm', color: '#555555', flex: 4 },
          {
            type: 'text',
            text: `฿${Number(member.total_paid).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
            size: 'sm',
            color: '#06C755',
            align: 'end',
            weight: 'bold',
            flex: 4
          }
        ]
      });
    }
  }

  return {
    type: 'flex',
    altText: `สรุปรายจ่าย: ฿${data.totalExpense.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E293B',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: `📊 สรุปค่าใช้จ่าย (${data.periodLabel})`,
            color: '#94A3B8',
            size: 'sm',
            weight: 'bold'
          },
          {
            type: 'text',
            text: `฿${data.totalExpense.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            color: '#FFFFFF',
            weight: 'bold',
            size: 'xxl',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: '📁 ยอดแยกตามหมวดหมู่:',
            weight: 'bold',
            size: 'sm',
            color: '#333333'
          },
          ...categoryContents,
          ...memberBoxes
        ]
      }
    }
  };
}

/**
 * Creates confirmation Flex Message when category is saved
 */
export function createConfirmedFlex(category: string, amount: number, merchant?: string | null): messagingApi.FlexMessage {
  return {
    type: 'flex',
    altText: `บันทึกเรียบร้อย: ${category} ฿${amount.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: '✅ บันทึกรายการสำเร็จ',
            color: '#06C755',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
            weight: 'bold',
            size: 'xl'
          },
          {
            type: 'text',
            text: `หมวดหมู่: ${category}${merchant ? ` (${merchant})` : ''}`,
            size: 'sm',
            color: '#555555'
          }
        ]
      }
    }
  };
}
