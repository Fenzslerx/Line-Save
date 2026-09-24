import {
  upsertUser,
  upsertGroup,
  createTransaction,
  getCategorySummary,
  getGroupMemberSummary,
  getCachedExtraction,
  saveExtractionCache
} from '../src/db/queries';

/**
 * Minimal fake of the Cloudflare D1 API surface used by the query layer:
 * db.prepare(sql).bind(...params).run() / .all() / .first()
 */
function makeFakeD1(rows: any[] = []) {
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
          return { success: true };
        },
        async all() {
          calls.push({ sql: state.sql, params: state.params });
          return { results: rows, success: true };
        },
        async first() {
          calls.push({ sql: state.sql, params: state.params });
          return rows[0] ?? null;
        }
      };
    }
  } as any;
}

describe('D1 Query Layer', () => {
  it('should upsert a user nickname into user_profiles', async () => {
    const db = makeFakeD1();
    await upsertUser(db, { line_user_id: 'U123', nickname: 'John' });

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain('INSERT INTO user_profiles');
    expect(db.calls[0].sql).toContain('ON CONFLICT');
    expect(db.calls[0].params).toEqual(['U123', 'John']);
  });

  it('should upsert a group', async () => {
    const db = makeFakeD1();
    await upsertGroup(db, { line_group_id: 'G123', group_name: 'บ้าน' });

    expect(db.calls[0].sql).toContain('INSERT INTO bot_groups');
    expect(db.calls[0].params).toContain('G123');
  });

  it('should insert a transaction mapped to the existing D1 schema with normalized type', async () => {
    const db = makeFakeD1();
    await createTransaction(db, {
      line_user_id: 'U123',
      line_group_id: 'G123',
      amount: 350,
      type: 'income',
      category: 'เงินเดือน',
      merchant: 'บริษัท',
      date: '2026-09-25'
    });

    const { sql, params } = db.calls[0];
    expect(sql).toContain('INSERT INTO transactions');
    expect(sql).toContain('user_id');
    expect(sql).toContain('group_id');
    expect(sql).toContain('type');
    expect(params).toEqual(['U123', 'G123', 'income', 'เงินเดือน', 350, 'บริษัท', '2026-09-25']);
  });

  it('should summarize by category with date filters applied in group mode', async () => {
    const rows = [
      { category: 'อาหาร', type: 'expense', total_amount: 500, transaction_count: 2 },
      { category: 'เงินเดือน', type: 'income', total_amount: 900, transaction_count: 1 }
    ];
    const db = makeFakeD1(rows);
    const res = await getCategorySummary(db, {
      groupId: 'G123',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    const { sql, params } = db.calls[0];
    // Scope + date guards must be ANDed (the Supabase RPC precedence bug must not reappear)
    expect(sql).toContain('group_id = ?');
    expect(sql).toContain('date >= ?');
    expect(sql).toContain('date <= ?');
    expect(sql.match(/\bOR\b/i)).toBeNull();
    expect(params).toEqual(['G123', '2026-09-01', '2026-09-30']);
    expect(res).toHaveLength(2);
    expect(res[0].type).toBe('expense');
  });

  it('should summarize personal transactions only when no group is given', async () => {
    const db = makeFakeD1([]);
    await getCategorySummary(db, { userId: 'U123', startDate: '2026-09-01', endDate: '2026-09-30' });

    const { sql, params } = db.calls[0];
    expect(sql).toContain('user_id = ?');
    expect(sql).toContain('group_id IS NULL');
    expect(params).toEqual(['U123', '2026-09-01', '2026-09-30']);
  });

  it('should only count expenses in the group member summary', async () => {
    const rows = [
      { user_id: 'U1', nickname: 'ฟ้า', total_paid: 8000, transaction_count: 5 }
    ];
    const db = makeFakeD1(rows);
    const res = await getGroupMemberSummary(db, { groupId: 'G123', startDate: '2026-09-01', endDate: '2026-09-30' });

    const { sql, params } = db.calls[0];
    expect(sql).toContain("type = 'expense'");
    expect(sql).toContain('user_profiles');
    expect(params).toEqual(['G123', '2026-09-01', '2026-09-30']);
    expect(res[0].nickname).toBe('ฟ้า');
  });

  it('should return cached extraction only when fresh', async () => {
    const fresh = {
      is_slip: true,
      amount: 350,
      date: '2026-09-25',
      merchant: '7-Eleven',
      direction: 'expense',
      confidence: 'high'
    };
    const db = makeFakeD1([{ result_json: JSON.stringify(fresh) }]);
    const res = await getCachedExtraction(db, 'img:abc');

    expect(db.calls[0].sql).toContain('slip_dedup_cache');
    expect(db.calls[0].sql).toContain('created_at >=');
    expect(db.calls[0].params[0]).toBe('img:abc');
    expect(res).toEqual(fresh);
  });

  it('should return null when the cache row is unreadable', async () => {
    const db = makeFakeD1([{ result_json: 'not-json' }]);
    const res = await getCachedExtraction(db, 'img:abc');
    expect(res).toBeNull();
  });

  it('should save extraction into the dedup cache with an upsert', async () => {
    const db = makeFakeD1();
    const result = { is_slip: true, amount: 100, date: null, merchant: null, direction: null, confidence: 'low' as const };
    await saveExtractionCache(db, 'msg:M1', result);

    const { sql, params } = db.calls[0];
    expect(sql).toContain('slip_dedup_cache');
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe('msg:M1');
    expect(JSON.parse(params[1] as string)).toEqual(result);
  });
});
