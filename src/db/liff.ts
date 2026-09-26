import { D1Database } from './client';

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
 * recorded themselves.
 */

export async function listTransactionsByMonth(
  db: D1Database,
  userId: string,
  month: string // YYYY-MM
): Promise<LiffTransaction[]> {
  const { results } = await db
    .prepare(
      `SELECT id, type, category, amount, merchant, date, source
       FROM transactions
       WHERE user_id = ? AND substr(date, 1, 7) = ?
       ORDER BY date DESC, created_at DESC`
    )
    .bind(userId, month)
    .all();
  return (results || []).map(mapTransaction);
}

export async function getMonthTotals(
  db: D1Database,
  userId: string,
  month: string
): Promise<MonthTotals> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND substr(date, 1, 7) = ?`
    )
    .bind(userId, month)
    .first();
  return { income: Number(row?.income ?? 0), expense: Number(row?.expense ?? 0) };
}

export async function getCategoryTotalsByMonth(
  db: D1Database,
  userId: string,
  month: string
): Promise<{ category: string; type: 'income' | 'expense'; total: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT category, type, SUM(amount) AS total
       FROM transactions
       WHERE user_id = ? AND substr(date, 1, 7) = ?
       GROUP BY category, type
       ORDER BY total DESC`
    )
    .bind(userId, month)
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

/**
 * Counterparty memory: remember who transferred to/from the user and the
 * category last used with them, so future slips from the same person are
 * auto-categorized consistently.
 */
export async function upsertContact(
  db: D1Database,
  userId: string,
  name: string,
  type: 'income' | 'expense',
  category: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contact_names (user_id, name, type, category, seen_count, last_seen)
       VALUES (?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, name) DO UPDATE SET
         type = excluded.type,
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
  name: string
): Promise<{ category: string; type: 'income' | 'expense' } | null> {
  const row = await db
    .prepare('SELECT category, type FROM contact_names WHERE user_id = ? AND name = ?')
    .bind(userId, name)
    .first();
  if (!row || row.category == null) return null;
  return { category: String(row.category), type: row.type === 'income' ? 'income' : 'expense' };
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
