/**
 * Direction Engine v2 — pure decision logic for income vs expense.
 *
 * No DB, no network: the webhook builds a MemorySnapshot (contact_names +
 * slip_parties stats) and calls decideDirection(). Every verdict records
 * which rule decided it and whether the save is allowed to teach the
 * owner's identity — keyword/default guesses never are (anti-poison).
 *
 * Ladder: L0 receipt → L1 self-name → L2 self-tail → L3 recurring-side
 *         (cold-start bootstrap) → L4 party memory → L5 keyword → L6 default.
 */

export type TxDirection = 'income' | 'expense';

export type VerdictRule =
  | 'receipt'
  | 'self_name'
  | 'self_tail'
  | 'recurring_side'
  | 'payer_memory'
  | 'payee_memory'
  | 'keyword'
  | 'default_expense';

/** Everything the ladder may look at, extracted from the slip. */
export interface SlipFacts {
  amount: number;
  /** Direction guessed from slip WORDS — reflects the screenshot owner's app, not our wallet. Weak. */
  keywordDirection: TxDirection | null;
  partyFrom: string | null;
  partyTo: string | null;
  fromTails: string[];
  toTails: string[];
}

/** How often a name/tail key appeared on one side across the user's recent slips. */
export interface SideStat {
  side: 'from' | 'to';
  /** 'n:<normalized name>' or 't:<last4>' */
  key: string;
  distinctTx: number;
  distinctCounterparties: number;
}

/** All learned context, loaded once per slip by loadDirectionMemory(). */
export interface MemorySnapshot {
  /** Owner names (from ชื่อบัญชี command + verified learning). Raw strings. */
  selfNames: string[];
  /** Owner account tails, last 4 digits, learned as 'acc:1234' rows. */
  selfTails: Set<string>;
  /** People remembered as having paid us (role income). */
  payerNames: string[];
  /** Counterparties remembered as paid by us (role expense). */
  payeeNames: string[];
  /** Frequency stats from slip_parties for the cold-start bootstrap. */
  sideStats: SideStat[];
}

export interface DirectionVerdict {
  direction: TxDirection;
  rule: VerdictRule;
  /**
   * True only when the deciding signal PROVES which side the owner is on
   * (self-name / self-tail / recurring-side, or a user correction handled
   * outside). Saves with learnable=false must never write 'self' rows —
   * that is the feedback loop that poisoned v1's memory.
   */
  learnable: boolean;
  /** Best counterparty name for the decided direction, if any was printed. */
  counterparty: string | null;
}

// ---------------------------------------------------------------------------
// Name / tail helpers (shared semantics with the webhook's v1 code)
// ---------------------------------------------------------------------------

const NAME_PREFIX_RE = /^(ว่าที่|นาย|นางสาว|นาง|ด\.ต\.|จ\.อ\.|ร\.ต\.|ส\.อ\.|พ\.ต\.|ม\.ล\.|ม\.จ\.|คุณ)\s*/i;
/** KBank and most Thai banks print names in English with titles — strip them so
 *  a registered Thai name or a corrected English variant can still match. */
const NAME_PREFIX_EN_RE = /^(mrs\.?|miss\.?|mr\.?|ms\.?)\s*/i;

/** Strip titles/spaces/punctuation; lowercase. นายสมชาย ใจดี → สมชายใจดี,
 *  MR. SOMCHAI JAIDEE → somchaijaidee */
export function normalizeName(name: string): string {
  let n = String(name || '');
  let prev = '';
  while (n !== prev) {
    prev = n;
    n = n.replace(NAME_PREFIX_RE, '');
    n = n.replace(NAME_PREFIX_EN_RE, '');
  }
  return n.replace(/[\s.:\-]/g, '').toLowerCase().trim();
}

/** Equal after normalization, or a ≥4-char normalized name contained in the other. */
export function isSameName(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  return short.length >= 4 && long.includes(short);
}

/** Normalize any account number/mask to its last 4 digits. 'x1234'/'1234567890' → '7890'-style. */
export function tail4(raw: string): string {
  return String(raw || '').replace(/\D/g, '').slice(-4);
}

/** Today in Bangkok (UTC+7) as YYYY-MM-DD — toISOString() alone is UTC and off by one after 18:00. */
export function bkkToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function nameKey(name: string): string {
  return 'n:' + normalizeName(name);
}

export function tailKey(tail: string): string {
  return 't:' + tail4(tail);
}

// ---------------------------------------------------------------------------
// Internal (own-account) transfer detection
// ---------------------------------------------------------------------------

/**
 * Same party on both sides → own-account transfer, skip saving entirely.
 * v2: substring-similar names alone are NOT enough (father→son, branch names);
 * require exact normalized equality or a shared account tail.
 */
export function isInternalTransfer(a: string, b: string, aTails: string[] = [], bTails: string[] = []): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na && nb && na === nb) return true;
  const bt = new Set(bTails.map(tail4).filter(t => t.length === 4));
  return aTails.map(tail4).some(t => t.length === 4 && bt.has(t));
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/** Bootstrap thresholds: recurring on the same side of ≥2 slips with ≥2 DIFFERENT counterparties. */
export const BOOTSTRAP_MIN_TX = 2;
export const BOOTSTRAP_MIN_COUNTERPARTIES = 2;

function bootstrapVerdict(
  m: MemorySnapshot,
  from: string | null,
  to: string | null,
  fromTails: string[],
  toTails: string[]
): DirectionVerdict | null {
  const strong = (side: 'from' | 'to', key: string) =>
    m.sideStats.some(
      s =>
        s.side === side &&
        s.key === key &&
        s.distinctTx >= BOOTSTRAP_MIN_TX &&
        s.distinctCounterparties >= BOOTSTRAP_MIN_COUNTERPARTIES
    );

  const fromKeys = (from ? [nameKey(from)] : []).concat(fromTails.map(tailKey));
  const toKeys = (to ? [nameKey(to)] : []).concat(toTails.map(tailKey));
  const fromStrong = fromKeys.some(k => strong('from', k));
  const toStrong = toKeys.some(k => strong('to', k));
  // Both sides recurrent (or neither) → not provable, stay conservative.
  if (fromStrong === toStrong) return null;
  if (fromStrong) {
    return { direction: 'expense', rule: 'recurring_side', learnable: true, counterparty: to };
  }
  return { direction: 'income', rule: 'recurring_side', learnable: true, counterparty: from };
}

/**
 * Decide income vs expense for one slip. Never throws, never blocks:
 * the bottom layers always produce a direction (full-auto contract).
 */
export function decideDirection(f: SlipFacts, m: MemorySnapshot): DirectionVerdict {
  const from = f.partyFrom?.trim() || null;
  const to = f.partyTo?.trim() || null;
  const fromTails = [...new Set((f.fromTails || []).map(tail4).filter(t => t.length === 4))];
  const toTails = [...new Set((f.toTails || []).map(tail4).filter(t => t.length === 4))];

  // L0 — receipt / QR pay: no transfer parties printed at all. Always expense,
  // unless the words clearly say incoming money (rare, no payer printed).
  if (!from && !to && fromTails.length === 0 && toTails.length === 0) {
    return {
      direction: f.keywordDirection === 'income' ? 'income' : 'expense',
      rule: 'receipt',
      learnable: false,
      counterparty: null
    };
  }

  // L1 — printed self name: the strongest textual signal. Works even when the
  // other side's name is missing (v1 required both).
  const fromOwn = from != null && m.selfNames.some(o => isSameName(o, from));
  const toOwn = to != null && m.selfNames.some(o => isSameName(o, to));
  if (toOwn && !fromOwn) return { direction: 'income', rule: 'self_name', learnable: true, counterparty: from };
  if (fromOwn && !toOwn) return { direction: 'expense', rule: 'self_name', learnable: true, counterparty: to };

  // L2 — account-tail signature: digits never OCR-garble like Thai names.
  if (m.selfTails.size > 0) {
    const fromHit = fromTails.some(t => m.selfTails.has(t));
    const toHit = toTails.some(t => m.selfTails.has(t));
    if (toHit && !fromHit) return { direction: 'income', rule: 'self_tail', learnable: true, counterparty: from };
    if (fromHit && !toHit) return { direction: 'expense', rule: 'self_tail', learnable: true, counterparty: to };
  }

  // L3 — cold-start bootstrap: see BOOTSTRAP_* constants.
  const boot = bootstrapVerdict(m, from, to, fromTails, toTails);
  if (boot) return boot;

  // L4 — counterparty memory (never proves the owner side → not learnable).
  if (from && m.payerNames.some(p => isSameName(p, from))) {
    return { direction: 'income', rule: 'payer_memory', learnable: false, counterparty: from };
  }
  if (to && m.payeeNames.some(p => isSameName(p, to))) {
    return { direction: 'expense', rule: 'payee_memory', learnable: false, counterparty: to };
  }

  // L5 — slip words. They describe the SCREENSHOT owner's transaction, not
  // ours: incoming screenshots also say "โอนสำเร็จ". Decision-only, never learn.
  if (f.keywordDirection) {
    return { direction: f.keywordDirection, rule: 'keyword', learnable: false, counterparty: from ?? to };
  }

  // L6 — full-auto default: most forwarded slips are the user's own payments.
  return { direction: 'expense', rule: 'default_expense', learnable: false, counterparty: to ?? from };
}

/** Empty snapshot for DB-less contexts (local dev, tests of other layers). */
export function emptyMemory(): MemorySnapshot {
  return { selfNames: [], selfTails: new Set(), payerNames: [], payeeNames: [], sideStats: [] };
}
