import {
  parseSlipFromOcr,
  parseAmount,
  parseThaiDate,
  bahtMarkedAmounts
} from '../src/services/slipParser';

describe('AI-free slip parser (rule-based, from Typhoon OCR text)', () => {
  it('should parse a standard PromptPay outgoing transfer', () => {
    const text = [
      'ธนาคารกสิกรไทย',
      'โอนเงินสำเร็จ',
      'จำนวนเงิน 350.00 บาท',
      'วันที่ 15 มิ.ย. 2568 14:02',
      'โอนไปที่ นายสมชาย ใจดี',
      'KTB : x1234'
    ].join('\n');
    const r = parseSlipFromOcr(text);
    expect(r).not.toBeNull();
    expect(r!.is_slip).toBe(true);
    expect(r!.amount).toBe(350);
    expect(r!.direction).toBe('expense');
    expect(r!.date).toBe('2025-06-15'); // BE 2568 → 2025
    expect(r!.merchant).toContain('นายสมชาย');
    expect(r!.confidence).toBe('high');
  });

  it('should parse an incoming transfer as income', () => {
    const text = 'เงินเข้า รับโอนพร้อมเพย์ จำนวนเงิน 1,000.00 บาท วันที่ 26/09/2569 รับจาก นายสมชาย';
    const r = parseSlipFromOcr(text);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('income');
    expect(r!.amount).toBe(1000);
    expect(r!.category).toBe('รายรับทั่วไป');
    expect(r!.merchant).toContain('นายสมชาย');
  });

  it('should parse a shop receipt and classify the food category', () => {
    const text = 'ร้านกาแฟดาวร้อย\nใบเสร็จรับเงิน\nยอดรวมทั้งสิ้น 65.00 บาท\n26/09/2568 08:15\nสาขาสยาม';
    const r = parseSlipFromOcr(text);
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(65);
    expect(r!.direction).toBe('expense');
    expect(r!.category).toBe('อาหารและเครื่องดื่ม');
    expect(r!.date).toBe('2025-09-26');
  });

  it('should prefer the amount keyword number when several baht amounts exist', () => {
    const text = 'ค่าใช้จ่ายอื่น ๆ 20 บาท\nยอดชำระทั้งสิ้น 129.00 บาท\nค่าจัดส่ง 45 บาท';
    expect(parseAmount(text)).toBe(129);
  });

  it('should pick the date closest to วันที่ among numeric candidates', () => {
    const text = 'อ้างอิง 05/09/2568\nวันที่ทำรายการ 15/06/2568';
    // "วันที่" appears as part of วันที่ทำรายการ before 15/06/2568
    expect(parseThaiDate(text)).toBe('2025-06-15');
  });

  it('should return null for text without an amount (falls back to AI)', () => {
    expect(parseSlipFromOcr('แมวส้มอ้วนน่ารักมาก นอนทั้งวัน')).toBeNull();
  });

  it('should return null when there is an amount but no direction keyword', () => {
    expect(parseSlipFromOcr('สวัสดีครับ 50 บาท')).toBeNull();
  });

  it('should map fuel to การเดินทาง and utilities to บิลและสาธารณูปโภค', () => {
    const fuel = parseSlipFromOcr('ปั๊ม PTT โอนสำเร็จ จำนวนเงิน 500 บาท 26/09/2568');
    expect(fuel!.category).toBe('การเดินทาง');
    const util = parseSlipFromOcr('ค่าไฟฟ้า การไฟฟ้านครหลวง ชำระเงิน 834.50 บาท 26/09/2568');
    expect(util!.category).toBe('บิลและสาธารณูปโภค');
  });

  it('should reject future dates', () => {
    expect(bahtMarkedAmounts('฿1,234.56')).toEqual([1234.56]);
    const farFuture = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const beYear = farFuture.getFullYear() + 543;
    const text = `โอนสำเร็จ จำนวนเงิน 100 บาท วันที่ ${farFuture.getDate()}/${farFuture.getMonth() + 1}/${beYear}`;
    const r = parseSlipFromOcr(text);
    expect(r).not.toBeNull();
    expect(r!.date).toBeNull(); // future date dropped, everything else parses
  });
});
