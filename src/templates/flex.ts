import { messagingApi } from '@line/bot-sdk';
import { config } from '../config/env';

export interface AutoSavedData {
  amount: number;
  merchant: string | null;
  date: string;
  type: 'expense' | 'income';
  category: string;
  /** Set when the caller knows the saved row id — enables the type-toggle button */
  txId?: string | null;
}

export interface DuplicateSlipData {
  existing: {
    amount: number;
    type: 'expense' | 'income';
    category: string;
    merchant: string | null;
    date: string;
  };
  incoming: {
    amount: number;
    type: 'expense' | 'income';
    category: string;
    merchant: string | null;
    date: string;
  };
  /** LINE message id of the new slip — postback actions reference it */
  messageId: string;
}

export interface SummaryData {
  periodLabel: string;
  totalExpense: number;
  totalIncome?: number;
  categoryBreakdown: { category: string; total_amount: number; transaction_count: number }[];
  memberBreakdown?: { nickname: string; total_paid: number; transaction_count: number }[];
}

/**
 * Creates the auto-saved confirmation card shown right after a slip is parsed
 * and recorded — zero interaction required. The single button opens the LIFF
 * dashboard where the user can review or edit the entry.
 */
export function createAutoSavedFlex(data: AutoSavedData): messagingApi.FlexMessage {
  const isIncome = data.type === 'income';
  const liffUrl = config.liffId ? `https://liff.line.me/${config.liffId}` : null;

  const rows: messagingApi.FlexComponent[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: isIncome ? 'ประเภท' : 'ร้านค้า/ผู้รับ', size: 'sm', color: '#888888', flex: 3 },
        {
          type: 'text',
          text: isIncome ? '💰 รายรับ' : (data.merchant || 'ไม่ระบุ'),
          size: 'sm',
          color: '#111111',
          weight: 'bold',
          align: 'end',
          flex: 5,
          wrap: true
        }
      ]
    },
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'หมวดหมู่', size: 'sm', color: '#888888', flex: 3 },
        { type: 'text', text: data.category, size: 'sm', color: '#111111', weight: 'bold', align: 'end', flex: 5 }
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
  ];

  const footer: messagingApi.FlexComponent[] = [];
  if (data.txId) {
    footer.push({
      type: 'button',
      action: {
        type: 'postback',
        label: isIncome ? 'สลับเป็นรายจ่าย' : 'สลับเป็นรายรับ',
        data: `act=toggle_type&tx=${encodeURIComponent(data.txId)}`,
        displayText: 'สลับประเภทรายการ'
      },
      style: 'secondary',
      height: 'sm'
    });
  }
  if (liffUrl) {
    footer.push({
      type: 'button',
      action: { type: 'uri', label: 'ดูรายการทั้งหมด', uri: liffUrl },
      style: 'primary',
      color: '#06C755',
      height: 'sm'
    });
  }

  return {
    type: 'flex',
    altText: `${isIncome ? 'รายรับ' : 'บันทึก'} ฿${data.amount.toLocaleString()} · ${data.category}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: isIncome ? '#0E9F6E' : '#06C755',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: isIncome ? '✅ บันทึกรายรับแล้ว (อัตโนมัติ)' : '✅ บันทึกรายจ่ายแล้ว (อัตโนมัติ)',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `${isIncome ? '+' : '−'}฿${data.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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
        spacing: 'xs',
        contents: rows
      },
      footer: footer.length
        ? { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer }
        : undefined
    }
  };
}

/**
 * Duplicate-slip warning card — shown instead of auto-saving when the extracted
 * slip content matches an existing transaction. Lets the user confirm a genuine
 * second payment or skip the duplicate.
 */
export function createDuplicateSlipFlex(data: DuplicateSlipData): messagingApi.FlexMessage {
  const typeLabel = (t: 'expense' | 'income') => (t === 'income' ? 'รายรับ' : 'รายจ่าย');
  const baht = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const row = (label: string, value: string) =>
    ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: label, size: 'sm', color: '#888888', flex: 3 },
        { type: 'text', text: value, size: 'sm', color: '#111111', weight: 'bold', align: 'end', flex: 5, wrap: true }
      ]
    }) as messagingApi.FlexComponent;

  return {
    type: 'flex',
    altText: `สลิปนี้น่าจะบันทึกไว้แล้ว (${typeLabel(data.existing.type)} ${baht(data.existing.amount)}) — กดเพื่อยืนยัน`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F59E0B',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'สลิปนี้น่าจะบันทึกไว้แล้ว',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `พบรายการ ${typeLabel(data.existing.type)} ${baht(data.existing.amount)} ที่ตรงกันอยู่แล้ว`,
            color: '#FFFFFF',
            size: 'sm',
            margin: 'sm',
            wrap: true
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        contents: [
          { type: 'text', text: 'รายการเดิมในระบบ', size: 'xs', color: '#888888', weight: 'bold' },
          row('ประเภท', typeLabel(data.existing.type)),
          row('จำนวนเงิน', baht(data.existing.amount)),
          row('หมวดหมู่', data.existing.category),
          row('ร้านค้า/ผู้รับ', data.existing.merchant || 'ไม่ระบุ'),
          row('วันที่', data.existing.date),
          { type: 'separator', margin: 'md' },
          {
            type: 'text',
            text: 'ถ้าเป็นการจ่ายครั้งใหม่จริง ๆ กด "บันทึกอยู่ดี" ได้เลย',
            size: 'xs',
            color: '#888888',
            wrap: true,
            margin: 'sm'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'บันทึกอยู่ดี',
              data: `act=dup_save&msg=${encodeURIComponent(data.messageId)}`,
              displayText: 'บันทึกอยู่ดี'
            },
            style: 'primary',
            color: '#06C755',
            height: 'sm'
          },
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'ข้าม ไม่บันทึก',
              data: `act=dup_skip&msg=${encodeURIComponent(data.messageId)}`,
              displayText: 'ไม่บันทึก'
            },
            style: 'secondary',
            height: 'sm'
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

  const incomeBoxes: messagingApi.FlexComponent[] = [];
  if (data.totalIncome !== undefined && data.totalIncome > 0) {
    incomeBoxes.push(
      { type: 'separator', margin: 'md' },
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '💰 รายรับรวม', size: 'sm', color: '#555555', flex: 4 },
          {
            type: 'text',
            text: `+฿${data.totalIncome.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            size: 'sm',
            color: '#06C755',
            align: 'end',
            weight: 'bold',
            flex: 4
          }
        ]
      }
    );
  }

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
            text: '💸 ยอดจ่ายแยกตามหมวดหมู่:',
            weight: 'bold',
            size: 'sm',
            color: '#333333'
          },
          ...categoryContents,
          ...incomeBoxes,
          ...memberBoxes
        ]
      }
    }
  };
}
