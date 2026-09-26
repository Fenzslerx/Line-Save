/**
 * AI-free slip parser — reads a Thai bank slip / receipt from Typhoon OCR text
 * using format rules instead of an LLM. Thai slips are highly templated
 * (amount next to บาท, direction keywords, BE dates), so a rule-based parse
 * covers most slips with zero API cost. Returns null when not confident —
 * the caller falls back to Gemini for those.
 */
import { SlipExtractionResult } from './vision';

/** Numbers sitting next to a currency marker (บาท/THB/฿) — the most trustworthy amounts. */
export function bahtMarkedAmounts(text: string): number[] {
  const amounts: number[] = [];
  const re = /(?:฿\s*(\d[\d,]*(?:\.\d{1,2})?))|((\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|THB))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] ?? m[2];
    if (raw) amounts.push(parseFloat(raw.replace(/,/g, '')));
  }
  return amounts;
}

const AMOUNT_KEYWORDS = [
  'จำนวนเงิน', 'ยอดรวม', 'รวมทั้งสิ้น', 'ยอดชำระ', 'ยอดเงิน',
  'ค่าบริการ', 'จำนวน', 'รวม', 'ยอด'
];

const INCOME_HINTS = ['เงินเข้า', 'รับโอน', 'รับเงิน', 'โอนเข้า', 'เครดิตเงินเข้า', 'รับจาก', 'เงินโอนเข้า'];
const EXPENSE_HINTS = [
  'โอนสำเร็จ', 'โอนเงิน', 'โอนออก', 'โอนผ่าน', 'ชำระเงิน', 'ชำระบิล', 'จ่ายเงิน',
  'สแกนจ่าย', 'จ่ายด้วย', 'ยอดชำระ', 'ค่าสินค้า', 'ใบเสร็จ', 'payment', 'purchase'
];

const THAI_MONTHS: [RegExp, number][] = [
  [/ม\.?ค|มกรา/, 1], [/ก\.?พ|กุมภา/, 2], [/มี\.?ค|มีนา/, 3], [/เม\.?ย|เมษา/, 4],
  [/พ\.?ค|พฤษภา/, 5], [/มิ\.?ย|มิถุนา/, 6], [/ก\.?ค|กรกฎา/, 7], [/ส\.?ค|สิงหา/, 8],
  [/ก\.?ย|กันยา/, 9], [/ต\.?ค|ตุลา/, 10], [/พ\.?ย|พฤศจิกา/, 11], [/ธ\.?ค|ธันวา/, 12]
];

function toGregorianYear(year: number): number {
  if (year >= 2400 && year <= 2700) return year - 543; // Buddhist Era
  return year;
}

function futureDate(date: string): boolean {
  const ts = new Date(`${date}T00:00:00Z`).getTime();
  return isNaN(ts) || ts > Date.now() + 2 * 24 * 60 * 60 * 1000;
}

/** Current year in ThaiBE-insensitive terms — used when a month-name date omits the year. */
function defaultYear(): number {
  return new Date().getFullYear();
}

/** "15/06/2568", "2026-09-23", "15 ก.ย. 2569", "15 มิ.ย.68" — first plausible date wins. */
export function parseThaiDate(text: string): string | null {
  // Thai month-name dates (ปี พ.ศ. 4 หลัก / 2 หลัก / หรือไม่มีปีเลย)
  for (const [monRe, month] of THAI_MONTHS) {
    const re = new RegExp(`(\\d{1,2})\\s+(${monRe.source})[a-zก-๙]*\\.?\\s*(\\d{2,4})?`, 'i');
    const m = re.exec(text);
    if (m) {
      const day = +m[1];
      const rawYear = m[3] ? +m[3] : null;
      const year = rawYear === null
        ? defaultYear()
        : toGregorianYear(m[3]!.length === 2 ? 2500 + rawYear : rawYear);
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (day >= 1 && day <= 31 && !futureDate(date)) return date;
      // A missing year that lands in the future belongs to last year
      if (day >= 1 && day <= 31 && futureDate(date) && !m[3]) {
        const lastYear = `${year - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (!futureDate(lastYear)) return lastYear;
      }
    }
  }
  // Numeric dates — pick the candidate whose preceding text contains "วันที่"
  const candidates: { date: string; pos: number }[] = [];
  const re = /(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let day: number, month: number, year: number;
    if (m[1].length === 4) { year = toGregorianYear(+m[1]); month = +m[2]; day = +m[3]; }
    else { day = +m[1]; month = +m[2]; year = m[3].length === 2 ? toGregorianYear(2500 + +m[3]) : toGregorianYear(+m[3]); }
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!futureDate(date)) candidates.push({ date, pos: m.index });
  }
  if (!candidates.length) return null;
  // Anchor: a candidate is "the transaction date" when "วันที่" appears shortly
  // BEFORE it — an earlier unrelated number (reference ids etc.) must not win.
  let best: { date: string; anchor: number; pos: number } | null = null;
  for (const c of candidates) {
    const before = text.slice(0, c.pos);
    const anchor = before.lastIndexOf('วันที่');
    const dist = anchor < 0 ? Infinity : c.pos - (anchor + 'วันที่'.length);
    if (!best || dist < best.anchor || (dist === best.anchor && c.pos > best.pos)) {
      best = { date: c.date, anchor: dist, pos: c.pos };
    }
  }
  return best!.date;
}

/** Best amount: the baht-marked number right AFTER an amount keyword (next ~80 chars). */
export function parseAmount(text: string): number | null {
  const amounts = bahtMarkedAmounts(text);
  if (amounts.length === 0) return null;
  const unique = [...new Set(amounts)];
  if (unique.length === 1) return unique[0];

  let best: { amount: number; dist: number } | null = null;
  for (const kw of AMOUNT_KEYWORDS) {
    const kwPos = text.indexOf(kw);
    if (kwPos < 0) continue;
    const re = /(?:฿\s*(\d[\d,]*(?:\.\d{1,2})?))|((\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|THB))/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1] ?? m[2];
      if (!raw) continue;
      // Only amounts following the keyword count — the previous line's total
      // (e.g. "20 บาท\nยอดชำระ ... 129 บาท") must not win by sitting closer.
      const dist = m.index - kwPos;
      if (dist < 0 || dist > 80) continue;
      if (!best || dist < best.dist) best = { amount: parseFloat(raw.replace(/,/g, '')), dist };
    }
  }
  return best ? best.amount : null;
}

/**
 * Fallback for PromptPay/QR e-slips that print the amount WITHOUT a currency
 * marker, e.g. "ยอดเงิน 300.00" or "จำนวนเงิน : 1,250.00" — take the bare
 * number directly after an amount keyword.
 */
export function parseBareAmount(text: string): number | null {
  for (const kw of AMOUNT_KEYWORDS) {
    const re = new RegExp(kw + '\\s*[:\\-]?\\s*([\\d][\\d,]*(?:\\.\\d{1,2})?)', 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function detectDirection(text: string): 'income' | 'expense' | null {
  const has = (hints: string[]) => hints.some(h => text.toLowerCase().includes(h.toLowerCase()));
  const income = has(INCOME_HINTS);
  const expense = has(EXPENSE_HINTS);
  if (income && !expense) return 'income';
  if (expense && !income) return 'expense';
  if (income && expense) {
    // Whichever keyword appears first usually states the transaction type
    const firstIncome = Math.min(...INCOME_HINTS.map(h => {
      const i = text.toLowerCase().indexOf(h.toLowerCase()); return i < 0 ? Infinity : i;
    }));
    const firstExpense = Math.min(...EXPENSE_HINTS.map(h => {
      const i = text.toLowerCase().indexOf(h.toLowerCase()); return i < 0 ? Infinity : i;
    }));
    return firstIncome <= firstExpense ? 'income' : 'expense';
  }
  return null;
}

const FROM_MARKERS = ['รับจาก', 'โอนโดย', 'ผู้โอน', 'จาก'];
const TO_MARKERS = ['โอนไปที่', 'ไปยัง', 'โอนไป', 'ผู้รับ', 'ถึง', 'ร้าน', 'สาขา'];

function cleanPartyName(raw: string): string | null {
  let value = raw.replace(/^[:\-\s]+/, '').trim();
  // Strip account refs / phone numbers / reference codes from the tail
  value = value
    .replace(/\b[xX×*]\d[\dxX×*\-]*\b/g, '')
    .replace(/\d[\d\-,/]{3,}/g, '')
    .trim();
  if (value.length < 2 || !/[ก-๙a-zA-Z]/.test(value)) return null;
  return value.slice(0, 60);
}

/** First line carrying one of the markers; Thai names outrank bank names. */
function pickParty(lines: string[], markers: string[]): string | null {
  let latinFallback: string | null = null;
  for (const line of lines) {
    for (const marker of markers) {
      const idx = line.indexOf(marker);
      if (idx < 0) continue;
      const value = cleanPartyName(line.slice(idx + marker.length));
      if (!value) continue;
      if (/[ก-๙]/.test(value)) return value;
      latinFallback ??= value;
    }
  }
  return latinFallback;
}

/** Both printed parties of a transfer: who sent it and who received it. */
export function parseParties(text: string): { from: string | null; to: string | null } {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  return {
    from: pickParty(lines, FROM_MARKERS),
    to: pickParty(lines, TO_MARKERS)
  };
}

/**
 * Account-tail signatures per party side. v2: the account number is often on
 * its OWN line under the party label ("โอนไปที่ นายสมชาย\nKTB : x1234") —
 * attach continuation lines to the nearest preceding marker side. Bare
 * continuation numbers are accepted only as masked tails (x1234) or full
 * 10–12 digit accounts, so 15+ digit reference numbers never attach.
 */
export function parsePartyTails(text: string): { from: string[]; to: string[] } {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const out = { from: [] as string[], to: [] as string[] };
  const tailsOnLine = (line: string) => {
    const tails: string[] = [];
    for (const m of line.matchAll(/\b[xX×*](\d{3,4})\b/g)) tails.push(m[1]);
    for (const m of line.matchAll(/\b\d{4,}\b/g)) tails.push(m[0].replace(/\D/g, '').slice(-4));
    return tails;
  };
  let pendingSide: 'from' | 'to' | null = null;
  for (const line of lines) {
    const isFrom = FROM_MARKERS.some(m => line.includes(m));
    const isTo = !isFrom && TO_MARKERS.some(m => line.includes(m));
    if (isFrom || isTo) {
      pendingSide = isFrom ? 'from' : 'to';
      for (const t of tailsOnLine(line)) out[pendingSide].push(t);
      continue;
    }
    if (!pendingSide) continue;
    // Continuation line: masked tail or full account number only
    const masked = [...line.matchAll(/\b[xX×*](\d{3,4})\b/g)].map(m => m[1]);
    const full = [...line.matchAll(/\b(\d{10,12})\b/g)].map(m => m[1].slice(-4));
    const tails = [...masked, ...full];
    if (tails.length) {
      for (const t of tails) out[pendingSide].push(t);
      pendingSide = null; // consumed — a later bare number belongs to nobody
    }
  }
  return { from: [...new Set(out.from)], to: [...new Set(out.to)] };
}

/**
 * Counterparty name (who sent / who received). Direction-aware markers and a
 * bottom-up scan: on Thai slips the "จาก/ถึง" block sits near the bottom, so
 * the last matching line is the real party — not a header mention.
 */
export function parseCounterparty(text: string, direction: 'income' | 'expense' | null): string | null {
  const markers = direction === 'income'
    ? ['รับจาก', 'โอนโดย', 'ผู้โอน', 'จาก']
    : direction === 'expense'
      ? ['โอนไปที่', 'ไปยัง', 'โอนไป', 'ผู้รับ', 'ถึง', 'ร้าน', 'สาขา']
      // Unknown direction — receiver-side names are the most useful merchant guess
      : ['โอนไปที่', 'ไปยัง', 'โอนไป', 'ผู้รับ', 'ถึง', 'ร้าน', 'สาขา', 'จาก'];
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  let latinFallback: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    for (const marker of markers) {
      const idx = line.indexOf(marker);
      if (idx < 0) continue;
      let value = line.slice(idx + marker.length).replace(/^[:\-\s]+/, '').trim();
      // Strip account refs / phone numbers / reference codes from the tail
      value = value
        .replace(/\b[xX×*]\d[\dxX×*\-]*\b/g, '')
        .replace(/\d[\d\-,/]{3,}/g, '')
        .trim();
      if (value.length < 2 || !/[ก-๙a-zA-Z]/.test(value)) continue;
      // Thai names are the counterparty on Thai slips; bank names (KBank etc.)
      // may appear on a neighboring line — remember them only as a fallback.
      if (/[ก-๙]/.test(value)) return value.slice(0, 60);
      latinFallback ??= value.slice(0, 60);
    }
  }
  return latinFallback;
}

const EXPENSE_CATEGORY_HINTS: [string, string[]][] = [
  ['อาหารและเครื่องดื่ม', ['กาแฟ', 'ชานม', 'ร้านกาแฟ', 'cafe', 'starbucks', 'อาหาร', 'ข้าว', 'ส้มตำ', 'สเต๊ก', 'ชาบู', 'พิซซ่า', 'pizza', 'kfc', 'mcd', 'ขนม', 'เบเกอรี่', 'bakery', 'เบียร์', 'เหล้า', 'foodpanda', 'grabfood', 'lineman', 'line man', 'ฟู้ด', 'restaurant', 'หมูกระทะ', 'แหนม', 'ตำแซบ']],
  ['การเดินทาง', ['น้ำมัน', 'ปั๊ม', 'ptt', 'บางจาก', 'shell', 'ค่าทาง', 'ด่วน', 'toll', 'แท็กซี่', 'taxi', 'grab', 'บขส.', 'รถไฟ', 'mrt', 'bts', 'ตั๋ว', 'ที่จอดรถ', 'จอดรถ', 'โรงแรม', 'ที่พัก', 'เช่ารถ', 'ค่ารถ']],
  ['บิลและสาธารณูปโภค', ['ค่าไฟ', 'ค่าน้ำ', 'ค่าเน็ต', 'อินเทอร์เน็ต', 'ค่าโทร', 'เติมเงิน', 'ais', 'true', 'dtac', 'nt ', '3bb', 'ประกัน', 'ค่าเช่า', 'พรบ', 'ภาษี', 'water', 'electric', 'ค่าโทรศัพท์', 'บัตรเครดิต', 'ผ่อน']],
  ['ของใช้ทั่วไป', ['7-eleven', 'เซเว่น', 'ซีเว่น', 'lotus', 'บิ๊กซี', 'makro', 'วัตสัน', 'watsons', 'shopee', 'lazada', 'tiktok shop', 'ร้านยา', 'ฟาร์มา', 'ยา', 'เครื่องใช้', 'ห้าง', 'ตลาดนัด', 'ร้านค้า']]
];

function parseCategory(text: string, direction: 'income' | 'expense' | null, merchant: string | null): string {
  if (direction === 'income') {
    const t = (merchant || '') + ' ' + text;
    if (/เงินเดือน|salary|โบนัส|bonus|ค่าคอม/i.test(t)) return 'เงินเดือน';
    if (/ขาย|shopee|lazada|รายได้|คอมมิชชัน/i.test(t)) return 'ขายของ';
    return 'รายรับทั่วไป';
  }
  const t = (merchant || '') + ' ' + text;
  for (const [category, words] of EXPENSE_CATEGORY_HINTS) {
    if (words.some(w => t.toLowerCase().includes(w.toLowerCase()))) return category;
  }
  return 'อื่นๆ';
}

/**
 * Rule-based extraction from OCR text. Returns null when the text does not
 * look like a slip (no amount / no direction keyword) — callers should then
 * use the AI path.
 */
export function parseSlipFromOcr(ocrText: string): SlipExtractionResult | null {
  if (!ocrText || ocrText.length < 15) return null;

  const amount = parseAmount(ocrText) ?? parseBareAmount(ocrText);
  const direction = detectDirection(ocrText);
  // v2: keyword direction is only a weak signal (L5) — the ladder in the
  // webhook decides instead, so slips with an amount but no keywords no
  // longer pay for Gemini.
  if (amount === null || amount <= 0) return null;

  const date = parseThaiDate(ocrText);
  const merchant = parseCounterparty(ocrText, direction);
  const category = parseCategory(ocrText, direction, merchant);
  const parties = parseParties(ocrText);
  const tails = parsePartyTails(ocrText);

  return {
    is_slip: true,
    amount,
    date,
    merchant,
    direction,
    category,
    party_from: parties.from,
    party_to: parties.to,
    party_from_tails: tails.from,
    party_to_tails: tails.to,
    // Rule-based parse of templated Thai slips is reliable when amount+direction both match
    confidence: 'high'
  };
}
