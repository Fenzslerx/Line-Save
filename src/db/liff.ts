import { D1Database } from './client';
import { MemorySnapshot, tail4 } from '../services/direction';

export interface LiffTransaction {
  id: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  merchant: string | null;
  date: string;
  source: string;
}

export interface MonthTotals {
  income: number;
  expense: number;
}

/**
 * LIFF-scoped queries. Unlike the bot's personal summary, these include the
 * user's group transactions too — the dashboard reflects everything the user
 * recorded themselves. month = 'all' aggregates every recorded month.
 */

const ALL_MONTHS = 'all';

function monthFilter(month: string): { where: string; params: unknown[] } {
  return month === ALL_MONTHS
    ? { where: '', params: [] }
    : { where: 'AND substr(date, 1, 7) = ?', params: [month] };
}

export async function listTransactionsByMonth(
  db: D1Database,
  userId: string,
  month: string // YYYY-MM or 'all'
): Promise<LiffTransaction[]> {
  const f = monthFilter(month);
  const { results } = await db
    .prepare(
      `SELECT id, type, category, amount, merchant, date, source
       FROM transactions
       WHERE user_id = ? ${f.where}
       ORDER BY date DESC, created_at DESC
       LIMIT 500`
    )
    .bind(userId, ...f.params)
    .all();
  return (results || []).map(mapTransaction);
}

export async function getMonthTotals(
  db: D1Database,
  userId: string,
  month: string
): Promise<MonthTotals> {
  const f = monthFilter(month);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? ${f.where}`
    )
    .bind(userId, ...f.params)
    .first();
  return { income: Number(row?.income ?? 0), expense: Number(row?.expense ?? 0) };
}

export async function getCategoryTotalsByMonth(
  db: D1Database,
  userId: string,
  month: string
): Promise<{ category: string; type: 'income' | 'expense'; total: number }[]> {
  const f = monthFilter(month);
  const { results } = await db
    .prepare(
      `SELECT category, type, SUM(amount) AS total
       FROM transactions
       WHERE user_id = ? ${f.where}
       GROUP BY category, type
       ORDER BY total DESC`
    )
    .bind(userId, ...f.params)
    .all();
  return (results || []).map(row => ({
    category: String(row.category),
    type: row.type === 'income' ? 'income' : 'expense',
    total: Number(row.total)
  }));
}

export async function getMonthlyTrend(
  db: D1Database,
  userId: string,
  months = 6
): Promise<{ month: string; income: number; expense: number }[]> {
  const firstMonth = monthShift(new Date(), -(months - 1));
  const { results } = await db
    .prepare(
      `SELECT substr(date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND date >= ?
       GROUP BY substr(date, 1, 7)
       ORDER BY month ASC`
    )
    .bind(userId, `${firstMonth}-01`)
    .all();
  return (results || []).map(row => ({
    month: String(row.month),
    income: Number(row.income),
    expense: Number(row.expense)
  }));
}

export function monthShift(base: Date, delta: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function createManualTransaction(
  db: D1Database,
  userId: string,
  tx: { amount: number; type: 'income' | 'expense'; category: string; merchant?: string | null; date: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO transactions (id, user_id, group_id, type, category, amount, merchant, date, source)
       VALUES (lower(hex(randomblob(16))), ?, NULL, ?, ?, ?, ?, ?, 'liff')`
    )
    .bind(userId, tx.type, tx.category, tx.amount, tx.merchant ?? null, tx.date)
    .run();
}

export async function updateTransaction(
  db: D1Database,
  userId: string,
  id: string,
  fields: { amount?: number; type?: 'income' | 'expense'; category?: string; merchant?: string | null; date?: string }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.amount !== undefined) { sets.push('amount = ?'); params.push(fields.amount); }
  if (fields.type !== undefined) { sets.push('type = ?'); params.push(fields.type); }
  if (fields.category !== undefined) { sets.push('category = ?'); params.push(fields.category); }
  if (fields.merchant !== undefined) { sets.push('merchant = ?'); params.push(fields.merchant); }
  if (fields.date !== undefined) { sets.push('date = ?'); params.push(fields.date); }
  if (sets.length === 0) return false;
  params.push(userId, id);
  const res = await db
    .prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
    .bind(...params)
    .run();
  return Boolean(res && (res as any).meta?.changes !== 0);
}

export async function deleteTransaction(db: D1Database, userId: string, id: string): Promise<void> {
  await db
    .prepare('DELETE FROM transactions WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .run();
}

export async function deleteTransactions(db: D1Database, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const statements = ids.map(id =>
    db.prepare('DELETE FROM transactions WHERE user_id = ? AND id = ?').bind(userId, id)
  );
  const results = await db.batch(statements);
  return results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
}

export async function getMonthlyBudget(db: D1Database, userId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT monthly_budget FROM budgets WHERE user_id = ?')
    .bind(userId)
    .first();
  return row ? Number(row.monthly_budget) : null;
}

export async function setMonthlyBudget(db: D1Database, userId: string, amount: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO budgets (user_id, monthly_budget, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET monthly_budget = excluded.monthly_budget, updated_at = datetime('now')`
    )
    .bind(userId, amount)
    .run();
}

export type ContactRole = 'income' | 'expense' | 'self';

/**
 * Counterparty memory: remember who transferred to/from the user and the
 * category last used with them, so future slips from the same person are
 * auto-categorized consistently. One name may hold several roles (paid them
 * AND received from them AND their own printed name on outgoing slips).
 */
export async function upsertContact(
  db: D1Database,
  userId: string,
  name: string,
  type: ContactRole,
  category: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contact_names (user_id, name, type, category, seen_count, last_seen)
       VALUES (?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, name, type) DO UPDATE SET
         category = COALESCE(excluded.category, contact_names.category),
         seen_count = contact_names.seen_count + 1,
         last_seen = datetime('now')`
    )
    .bind(userId, name, type, category)
    .run();
}

export async function findContact(
  db: D1Database,
  userId: string,
  name: string,
  type: ContactRole
): Promise<{ category: string; type: ContactRole; seen_count: number } | null> {
  const row = await db
    .prepare('SELECT category, type, seen_count FROM contact_names WHERE user_id = ? AND name = ? AND type = ?')
    .bind(userId, name, type)
    .first();
  if (!row) return null;
  return {
    category: String(row.category ?? ''),
    type: row.type as ContactRole,
    seen_count: Number(row.seen_count ?? 1)
  };
}

/** Names that belong to the account owner itself — learned from past slips + the "ชื่อ" command. */
export async function getOwnNames(db: D1Database, userId: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const self = await db
      .prepare("SELECT name FROM contact_names WHERE user_id = ? AND type = 'self'")
      .bind(userId)
      .all();
    (self.results || []).forEach(r => names.add(String(r.name)));
    const profile = await db
      .prepare('SELECT first_name FROM user_profiles WHERE user_id = ?')
      .bind(userId)
      .first();
    if (profile && profile.first_name) names.add(String(profile.first_name));
  } catch {
    /* memory tables missing — direction inference just stays off */
  }
  return names;
}

/**
 * Teach the bot: remember that a keyword maps to a category/type so future
 * manual entries and bot commands can auto-fill.
 */
export async function saveCategoryRule(
  db: D1Database,
  keyword: string,
  category: string,
  type: 'income' | 'expense'
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO category_rules (keyword, category, type)
       VALUES (?, ?, ?)
       ON CONFLICT(keyword) DO UPDATE SET category = excluded.category, type = excluded.type`
    )
    .bind(keyword, category, type)
    .run();
}

export async function findCategoryRule(
  db: D1Database,
  keyword: string
): Promise<{ category: string; type: 'income' | 'expense' } | null> {
  const exact = await db
    .prepare('SELECT category, type FROM category_rules WHERE keyword = ?')
    .bind(keyword)
    .first();
  if (exact) {
    return { category: String(exact.category), type: exact.type === 'income' ? 'income' : 'expense' };
  }
  const fuzzy = await db
    .prepare('SELECT category, type FROM category_rules WHERE instr(?, keyword) > 0 LIMIT 1')
    .bind(keyword)
    .first();
  if (fuzzy) {
    return { category: String(fuzzy.category), type: fuzzy.type === 'income' ? 'income' : 'expense' };
  }
  return null;
}

function mapTransaction(row: any): LiffTransaction {
  return {
    id: String(row.id),
    type: row.type === 'income' ? 'income' : 'expense',
    category: String(row.category),
    amount: Number(row.amount),
    merchant: row.merchant ?? null,
    date: String(row.date),
    source: String(row.source ?? 'manual')
  };
}

/** One query round per slip: roles + cold-start frequency stats. */
export async function loadDirectionMemory(db: D1Database, userId: string): Promise<MemorySnapshot> {
  const snap: MemorySnapshot = { selfNames: [], selfTails: new Set(), payerNames: [], payeeNames: [], sideStats: [] };
  const contacts = await db
    .prepare("SELECT name, type FROM contact_names WHERE user_id = ? AND type IN ('self','income','expense')")
    .bind(userId).all();
  for (const r of contacts.results || []) {
    const name = String(r.name);
    if (r.type === 'self') {
      if (name.startsWith('acc:')) snap.selfTails.add(name.slice(4));
      else if (name) snap.selfNames.push(name);
    } else if (r.type === 'income') snap.payerNames.push(name);
    else snap.payeeNames.push(name);
  }
  try {
    const stats = await db.prepare(
      `SELECT a.side AS side,
              CASE WHEN COALESCE(a.name_norm,'') != '' THEN 'n:' || a.name_norm ELSE 't:' || a.tail END AS key,
              COUNT(DISTINCT a.tx_id) AS distinctTx,
              COUNT(DISTINCT CASE WHEN COALESCE(b.name_norm,'') != '' THEN 'n:' || b.name_norm
                                  ELSE 't:' || b.tail END) AS distinctCounterparties
       FROM slip_parties a
       JOIN slip_parties b ON b.tx_id = a.tx_id AND b.side != a.side
            AND (COALESCE(b.name_norm,'') != '' OR b.tail IS NOT NULL)
       WHERE a.user_id = ?
       GROUP BY a.side, key`
    ).bind(userId).all();
    for (const r of stats.results || []) {
      snap.sideStats.push({
        side: r.side === 'to' ? 'to' : 'from',
        key: String(r.key),
        distinctTx: Number(r.distinctTx),
        distinctCounterparties: Number(r.distinctCounterparties)
      });
    }
  } catch { /* slip_parties not migrated yet — bootstrap stays off */ }
  return snap;
}

/** Remove 'self' rows proven wrong by a user correction (names + acc: tails). */
export async function unlearnSelf(db: D1Database, userId: string, names: string[], tails: string[]): Promise<void> {
  const targets = names.filter(Boolean).map(String)
    .concat(tails.filter(Boolean).map(t => 'acc:' + tail4(String(t))));
  if (!targets.length) return;
  await db.batch(
    targets.map(n =>
      db.prepare("DELETE FROM contact_names WHERE user_id = ? AND type = 'self' AND name = ?")
        .bind(userId, n))
  ).catch(() => {});
}

export interface SelfIdentity {
  /** Raw stored value — plain name or 'acc:<last4>' */
  name: string;
  kind: 'name' | 'tail';
}

/** The account owner's registered identities (for the LIFF "บัญชีของฉัน" page). */
export async function listSelfIdentities(db: D1Database, userId: string): Promise<SelfIdentity[]> {
  const { results } = await db
    .prepare("SELECT name FROM contact_names WHERE user_id = ? AND type = 'self' ORDER BY name")
    .bind(userId)
    .all();
  return (results || []).map(r => {
    const name = String(r.name ?? '');
    return { name, kind: name.startsWith('acc:') ? ('tail' as const) : ('name' as const) };
  });
}

/** Register an owner identity: plain names as-is, digit inputs become acc:<last4>. */
export async function addSelfIdentity(db: D1Database, userId: string, value: string): Promise<SelfIdentity> {
  const v = String(value || '').trim().slice(0, 60);
  if (!v) throw new Error('empty identity');
  const digits = v.replace(/\D/g, '');
  const isAccountNumber = /^[\d\s\-xX×*.]+$/.test(v) && digits.length >= 4;
  const name = isAccountNumber ? 'acc:' + tail4(digits) : v;
  await upsertContact(db, userId, name, 'self', null);
  return { name, kind: name.startsWith('acc:') ? 'tail' : 'name' };
}

export async function deleteSelfIdentity(db: D1Database, userId: string, value: string): Promise<void> {
  const v = String(value || '').trim();
  if (!v) return;
  const digits = v.replace(/\D/g, '');
  const isAccountNumber = /^[\d\s\-xX×*.]+$/.test(v) && digits.length >= 4;
  const target = isAccountNumber ? 'acc:' + tail4(digits) : v;
  await db
    .prepare("DELETE FROM contact_names WHERE user_id = ? AND type = 'self' AND name = ?")
    .bind(userId, target)
    .run();
}
