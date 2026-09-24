import {
  listTransactionsByMonth,
  getMonthTotals,
  getCategoryTotalsByMonth,
  getMonthlyTrend,
  createManualTransaction,
  updateTransaction,
  deleteTransaction,
  getMonthlyBudget,
  setMonthlyBudget,
  saveCategoryRule,
  findCategoryRule
} from '../src/db/liff';

function makeFakeD1(rows: any[] = [], firstRow: any = null) {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      const state = { sql, params: [] as any[] };
      return {
        bind(...params: any[]) {
          state.params = params;
          return this;
        },
        async run() {
          calls.push({ sql: state.sql, params: state.params });
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          calls.push({ sql: state.sql, params: state.params });
          return { results: rows, success: true };
        },
        async first() {
          calls.push({ sql: state.sql, params: state.params });
          return firstRow;
        }
      };
    }
  } as any;
}

describe('LIFF Query Layer', () => {
  it('should list transactions scoped to user and month, including group rows', async () => {
    const rows = [{ id: 'T1', type: 'expense', category: 'อาหาร', amount: 120, merchant: '7-11', date: '2026-09-10', source: 'line-bot' }];
    const db = makeFakeD1(rows);
    const res = await listTransactionsByMonth(db, 'U1', '2026-09');

    const { sql, params } = db.calls[0];
    expect(sql).toContain('user_id = ?');
    expect(sql).toContain('substr(date, 1, 7) = ?');
    expect(sql).not.toContain('group_id IS NULL'); // group expenses count as the user's own spending
    expect(params).toEqual(['U1', '2026-09']);
    expect(res[0]).toEqual({ id: 'T1', type: 'expense', category: 'อาหาร', amount: 120, merchant: '7-11', date: '2026-09-10', source: 'line-bot' });
  });

  it('should compute month totals with CASE per type', async () => {
    const db = makeFakeD1([], { income: 900, expense: 500 });
    const res = await getMonthTotals(db, 'U1', '2026-09');
    expect(db.calls[0].sql).toContain("type = 'income'");
    expect(res).toEqual({ income: 900, expense: 500 });
  });

  it('should compute a 6-month trend bounded by a start date', async () => {
    const db = makeFakeD1([{ month: '2026-09', income: 100, expense: 50 }]);
    const res = await getMonthlyTrend(db, 'U1', 6);
    expect(db.calls[0].sql).toContain('GROUP BY substr(date, 1, 7)');
    expect(db.calls[0].params[1]).toMatch(/^\d{4}-\d{2}-01$/);
    expect(res[0].month).toBe('2026-09');
  });

  it('should insert manual transactions with source=liff and no group', async () => {
    const db = makeFakeD1();
    await createManualTransaction(db, 'U1', {
      amount: 250, type: 'income', category: 'ขายของ', merchant: 'shopee', date: '2026-09-25'
    });
    const { sql, params } = db.calls[0];
    expect(sql).toContain('source)');
    expect(sql).toContain("VALUES (lower(hex(randomblob(16))), ?, NULL, ?, ?, ?, ?, ?, 'liff')");
    expect(params).toEqual(['U1', 'income', 'ขายของ', 250, 'shopee', '2026-09-25']);
  });

  it('should update only provided fields scoped to the owner', async () => {
    const db = makeFakeD1();
    const ok = await updateTransaction(db, 'U1', 'T9', { amount: 999, type: 'income' });
    const { sql, params } = db.calls[0];
    expect(sql).toContain('amount = ?');
    expect(sql).toContain('type = ?');
    expect(sql).not.toContain('merchant = ?');
    expect(sql).toContain('WHERE user_id = ? AND id = ?');
    expect(params).toEqual([999, 'income', 'U1', 'T9']);
    expect(ok).toBe(true);
  });

  it('should refuse updates with no fields', async () => {
    const db = makeFakeD1();
    const ok = await updateTransaction(db, 'U1', 'T9', {});
    expect(ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it('should delete scoped to the owner', async () => {
    const db = makeFakeD1();
    await deleteTransaction(db, 'U1', 'T9');
    expect(db.calls[0].sql).toContain('DELETE FROM transactions WHERE user_id = ? AND id = ?');
  });

  it('should upsert the monthly budget', async () => {
    const db = makeFakeD1([], { monthly_budget: 15000 });
    expect(await getMonthlyBudget(db, 'U1')).toBe(15000);
    await setMonthlyBudget(db, 'U1', 20000);
    expect(db.calls[1].sql).toContain('ON CONFLICT(user_id)');
  });

  it('should match category rules exactly first, then fuzzy', async () => {
    const db = makeFakeD1([], { category: 'อาหารและเครื่องดื่ม', type: 'expense' });
    const rule = await findCategoryRule(db, 'กาแฟ');
    expect(db.calls[0].sql).toContain('keyword = ?');
    expect(rule).toEqual({ category: 'อาหารและเครื่องดื่ม', type: 'expense' });
  });

  it('should upsert category rules', async () => {
    const db = makeFakeD1();
    await saveCategoryRule(db, 'กาแฟ', 'อาหารและเครื่องดื่ม', 'expense');
    expect(db.calls[0].sql).toContain('ON CONFLICT(keyword)');
    expect(db.calls[0].params).toEqual(['กาแฟ', 'อาหารและเครื่องดื่ม', 'expense']);
  });
});
