import {
  decideDirection,
  isInternalTransfer,
  normalizeName,
  isSameName,
  tail4,
  bkkToday,
  emptyMemory,
  MemorySnapshot,
  SlipFacts
} from '../src/services/direction';

function facts(over: Partial<SlipFacts> = {}): SlipFacts {
  return {
    amount: 100,
    keywordDirection: null,
    partyFrom: null,
    partyTo: null,
    fromTails: [],
    toTails: [],
    ...over
  };
}

function memory(over: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return { ...emptyMemory(), ...over };
}

describe('Direction Engine v2 — Trust Ladder', () => {
  // L0 — receipt
  it('L0: receipt with no parties is expense even without keywords', () => {
    const v = decideDirection(facts(), memory());
    expect(v).toMatchObject({ direction: 'expense', rule: 'receipt', learnable: false });
  });

  it('L0: receipt printed with an income keyword stays income', () => {
    const v = decideDirection(facts({ keywordDirection: 'income' }), memory());
    expect(v.direction).toBe('income');
  });

  // L1 — self name
  it('L1: TO side is our name → income, even when keywords say expense', () => {
    const v = decideDirection(
      facts({ keywordDirection: 'expense', partyFrom: 'นายสมชาย', partyTo: 'นายเจ้าของบัญชี' }),
      memory({ selfNames: ['นายเจ้าของบัญชี'] })
    );
    expect(v).toMatchObject({ direction: 'income', rule: 'self_name', learnable: true, counterparty: 'นายสมชาย' });
  });

  it('L1: FROM side is our name → expense; works without the TO name (v1 gap)', () => {
    const v = decideDirection(
      facts({ partyFrom: 'นายเจ้าของบัญชี' }),
      memory({ selfNames: ['เจ้าของบัญชี'] }) // substring match ≥4 chars
    );
    expect(v).toMatchObject({ direction: 'expense', rule: 'self_name', learnable: true });
  });

  // L2 — self tail
  it('L2: TO-side tail matches → income, even with no FROM name printed', () => {
    const v = decideDirection(
      facts({ keywordDirection: 'expense', partyTo: 'นายเจ้าของบัญชี', toTails: ['5678'] }),
      memory({ selfTails: new Set(['5678']) })
    );
    expect(v).toMatchObject({ direction: 'income', rule: 'self_tail', learnable: true });
  });

  it('L2: FROM-side tail matches → expense; full account numbers normalize to last 4', () => {
    const v = decideDirection(
      facts({ partyFrom: 'นายเอ', fromTails: ['1234567890'] }),
      memory({ selfTails: new Set(['7890']) })
    );
    expect(v).toMatchObject({ direction: 'expense', rule: 'self_tail' });
  });

  // L3 — cold-start bootstrap
  it('L3: name recurring on the TO side of ≥2 slips with ≥2 counterparties → income', () => {
    const m = memory({
      sideStats: [
        { side: 'to', key: 'n:เจ้าของบัญชี', distinctTx: 2, distinctCounterparties: 2 }
      ]
    });
    const v = decideDirection(facts({ partyFrom: 'นายสมชาย', partyTo: 'นายเจ้าของบัญชี' }), m);
    expect(v).toMatchObject({ direction: 'income', rule: 'recurring_side', learnable: true, counterparty: 'นายสมชาย' });
  });

  it('L3: a frequent payer (1 distinct counterparty) must NOT bootstrap', () => {
    const m = memory({
      sideStats: [
        { side: 'from', key: 'n:สมชาย', distinctTx: 5, distinctCounterparties: 1 } // always pays US
      ]
    });
    const v = decideDirection(facts({ partyFrom: 'นายสมชาย', partyTo: 'นายเจ้าของบัญชี' }), m);
    expect(v.rule).not.toBe('recurring_side');
    expect(v.direction).toBe('expense'); // fell to keyword/default
    expect(v.learnable).toBe(false);
  });

  it('L3: a shop we paid twice (1 distinct counterparty) must NOT bootstrap', () => {
    const m = memory({
      sideStats: [{ side: 'to', key: 'n:ร้านกาแฟ', distinctTx: 2, distinctCounterparties: 1 }]
    });
    const v = decideDirection(facts({ partyFrom: 'เรา', partyTo: 'ร้านกาแฟ' }), m);
    expect(v.rule).not.toBe('recurring_side');
  });

  it('L3: both sides recurrent → ambiguous, no bootstrap', () => {
    const m = memory({
      sideStats: [
        { side: 'from', key: 'n:ก', distinctTx: 3, distinctCounterparties: 3 },
        { side: 'to', key: 'n:ข', distinctTx: 3, distinctCounterparties: 3 }
      ]
    });
    expect(decideDirection(facts({ partyFrom: 'นายก', partyTo: 'นายข' }), m).rule).not.toBe('recurring_side');
  });

  it('L3: bootstrap also keys on account tails', () => {
    const m = memory({
      sideStats: [{ side: 'from', key: 't:1234', distinctTx: 2, distinctCounterparties: 2 }]
    });
    const v = decideDirection(facts({ partyFrom: 'ใครบางคน', fromTails: ['x1234'] }), m);
    expect(v).toMatchObject({ direction: 'expense', rule: 'recurring_side', learnable: true });
  });

  // L4 — party memory
  it('L4: remembered payer in the FROM position → income (not learnable)', () => {
    const v = decideDirection(
      facts({ keywordDirection: 'expense', partyFrom: 'นายสมชาย' }),
      memory({ payerNames: ['สมชาย'] })
    );
    expect(v).toMatchObject({ direction: 'income', rule: 'payer_memory', learnable: false });
  });

  it('L4: remembered payee in the TO position → expense', () => {
    const v = decideDirection(
      facts({ partyFrom: 'นายสมชาย', partyTo: 'ร้านกาแฟ' }),
      memory({ payeeNames: ['ร้านกาแฟ'] })
    );
    expect(v).toMatchObject({ direction: 'expense', rule: 'payee_memory', counterparty: 'ร้านกาแฟ' });
  });

  // L5 / L6 — weak fallbacks, never learnable (the anti-poison contract)
  it('L5: keyword decides only when nothing stronger exists, and never teaches', () => {
    const v = decideDirection(facts({ keywordDirection: 'income', partyFrom: 'นายสมชาย' }), memory());
    expect(v).toMatchObject({ direction: 'income', rule: 'keyword', learnable: false });
  });

  it('L6: no signal at all → default expense, not learnable', () => {
    const v = decideDirection(facts({ partyFrom: 'นายสมชาย', partyTo: 'ร้านบี' }), memory());
    expect(v).toMatchObject({ direction: 'expense', rule: 'default_expense', learnable: false });
  });

  it('anti-poison: no ladder layer above L4 may set learnable=true', () => {
    const cases = [
      decideDirection(facts(), memory()), // receipt
      decideDirection(facts({ keywordDirection: 'expense' }), memory()),
      decideDirection(facts({ partyFrom: 'นายสมชาย' }), memory({ payerNames: ['สมชาย'] }))
    ];
    for (const v of cases) expect(v.learnable).toBe(false);
  });
});

describe('internal transfer detection v2', () => {
  it('exact same normalized name on both sides → internal', () => {
    expect(isInternalTransfer('นายสมชาย ใจดี', 'สมชาย ใจดี')).toBe(true);
  });

  it('similar-but-different names alone are NOT internal (v1 false-skip fixed)', () => {
    expect(isInternalTransfer('สมชายใจดี', 'สมชายใจดีมาก')).toBe(false);
  });

  it('same account tail on both sides → internal even with different names', () => {
    expect(isInternalTransfer('นายเอ', 'นายบี', ['1234'], ['9991234'])).toBe(true);
  });

  it('different names and tails → not internal', () => {
    expect(isInternalTransfer('นายเอ', 'นายบี', ['1111'], ['2222'])).toBe(false);
  });
});

describe('helpers', () => {
  it('normalizeName strips repeated titles and separators', () => {
    expect(normalizeName('นายสมชาย ใจดี')).toBe('สมชายใจดี');
    expect(normalizeName('ว่าที่ ร.ต. กฤษดา')).toBe('กฤษดา');
    expect(normalizeName('KBank x1234')).toBe('kbankx1234');
  });

  it('normalizeName strips English bank titles (KBank prints MR./MRS. names)', () => {
    expect(normalizeName('MR. SOMCHAI JAIDEE')).toBe('somchaijaidee');
    expect(normalizeName('Mrs. Suda')).toBe('suda');
  });

  it('isSameName: exact, ≥4-char containment, rejects short noise', () => {
    expect(isSameName('นายสมชาย', 'สมชายใจดี')).toBe(true);
    expect(isSameName('Abc', 'abcd')).toBe(false); // short side < 4
    expect(isSameName('', 'สมชาย')).toBe(false);
  });

  it('tail4 normalizes masks and full account numbers', () => {
    expect(tail4('x1234')).toBe('1234');
    expect(tail4('123-4-56789-0')).toBe('7890');
    expect(tail4('')).toBe('');
  });

  it('bkkToday uses Bangkok local date, not UTC (after 18:00 BKK the day already flipped)', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-27T20:30:00Z').getTime()); // 28 Sep 03:30 BKK
    expect(bkkToday()).toBe('2026-09-28');
    spy.mockRestore();
  });
});
