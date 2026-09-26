import { D1Database } from './client';
import { SlipExtractionResult } from '../services/vision';
import { normalizeName, tail4 } from '../services/direction';

export interface UserRecord {
  line_user_id: string;
  nickname?: string;
  created_at?: string;
}

export interface GroupRecord {
  line_group_id: string;
  group_name?: string;
  created_at?: string;
}

export interface TransactionRecord {
  id?: string;
  line_user_id: string;
  line_group_id?: string | null;
  amount: number;
  type: 'income' | 'expense';
  category?: string | null;
  merchant?: string | null;
  date: string; // YYYY-MM-DD
  note?: string | null;
  slip_image_url?: string | null;
  created_at?: string;
}

export interface CategorySummary {
  category: string;
  type: 'income' | 'expense';
  total_amount: number;
  transaction_count: number;
}

export interface MemberSummary {
  line_user_id: string;
  nickname: string;
  total_paid: number;
  transaction_count: number;
}

/**
 * Register or update user nickname (stored in the existing user_profiles table)
 */
export async function upsertUser(db: D1Database, user: UserRecord): Promise<UserRecord> {
  await db
    .prepare(
      `INSERT INTO user_profiles (user_id, first_name, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE
         SET first_name = COALESCE(excluded.first_name, first_name),
             updated_at = datetime('now')`
    )
    .bind(user.line_user_id, user.nickname ?? null)
    .run();
  return user;
}

/**
 * Register or update a LINE group (bot-owned table, separate from the legacy schema)
 */
export async function upsertGroup(db: D1Database, group: GroupRecord): Promise<GroupRecord> {
  await db
    .prepare(
      `INSERT INTO bot_groups (line_group_id, group_name)
       VALUES (?, ?)
       ON CONFLICT(line_group_id) DO UPDATE
         SET group_name = COALESCE(excluded.group_name, group_name)`
    )
    .bind(group.line_group_id, group.group_name ?? null)
    .run();
  return group;
}

/**
 * Insert a new financial transaction.
 * Reuses the existing D1 `transactions` table so records saved by previous
 * versions of the bot remain visible; group_id was added by migrations/d1_schema.sql.
 */
export async function createTransaction(db: D1Database, tx: TransactionRecord): Promise<TransactionRecord> {
  const type = tx.type === 'income' ? 'income' : 'expense';
  const id = tx.id ?? crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO transactions (id, user_id, group_id, type, category, amount, merchant, date, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'line-bot')`
    )
    .bind(
      id,
      tx.line_user_id,
      tx.line_group_id ?? null,
      type,
      tx.category ?? 'อื่นๆ',
      tx.amount,
      tx.merchant ?? null,
      tx.date
    )
    .run();
  return { ...tx, id, type };
}

/**
 * Content-based slip dedup: a transaction from the same user with the same
 * type, amount, date and merchant already exists. Catches re-sent slips even
 * when the image bytes differ (re-screenshot, forwarded image). Merchant is
 * matched NULL-safely so unspecified-merchant slips only collide with each other.
 */
export async function findDuplicateSlip(
  db: D1Database,
  slip: { userId: string; amount: number; type: 'income' | 'expense'; date: string; merchant?: string | null }
): Promise<(TransactionRecord & { age_seconds: number | null }) | null> {
  const { results } = await db
    .prepare(
      `SELECT id, type, category, amount, merchant, date, source,
              CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS age_seconds
       FROM transactions
       WHERE user_id = ? AND type = ? AND amount = ? AND date = ?
         AND ((merchant IS NULL AND ? IS NULL) OR merchant = ?)
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(slip.userId, slip.type, slip.amount, slip.date, slip.merchant ?? null, slip.merchant ?? null)
    .all();
  const row = (results || [])[0];
  // Guard against malformed rows coming back from test doubles / partial schemas
  if (!row || row.id === undefined || row.amount === undefined || row.amount === null) return null;
  return {
    id: String(row.id),
    line_user_id: slip.userId,
    type: row.type === 'income' ? 'income' : 'expense',
    category: String(row.category ?? 'อื่นๆ'),
    amount: Number(row.amount),
    merchant: row.merchant ?? null,
    date: String(row.date),
    age_seconds: Number.isFinite(Number(row.age_seconds)) ? Number(row.age_seconds) : null
  };
}

export async function getTransactionById(
  db: D1Database,
  userId: string,
  id: string
): Promise<TransactionRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, group_id, type, category, amount, merchant, date, source
       FROM transactions WHERE user_id = ? AND id = ?`
    )
    .bind(userId, id)
    .first();
  if (!row || row.id === undefined) return null;
  return {
    id: String(row.id),
    line_user_id: userId,
    line_group_id: row.group_id ?? null,
    type: row.type === 'income' ? 'income' : 'expense',
    category: String(row.category ?? 'อื่นๆ'),
    amount: Number(row.amount),
    merchant: row.merchant ?? null,
    date: String(row.date)
  };
}

/**
 * Get category-based summary for a user or group over a date range.
 * Scope (group XOR personal) and date guards are ANDed — no OR precedence trap.
 */
export async function getCategorySummary(
  db: D1Database,
  options: {
    userId?: string;
    groupId?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<CategorySummary[]> {
  let sql: string;
  let params: unknown[];

  if (options.groupId) {
    sql = `
      SELECT COALESCE(category, 'ไม่ระบุ') AS category, type,
             SUM(amount) AS total_amount, COUNT(*) AS transaction_count
      FROM transactions
      WHERE group_id = ? AND date >= ? AND date <= ?
      GROUP BY category, type
      ORDER BY total_amount DESC`;
    params = [options.groupId, options.startDate ?? '0000-01-01', options.endDate ?? '9999-12-31'];
  } else {
    sql = `
      SELECT COALESCE(category, 'ไม่ระบุ') AS category, type,
             SUM(amount) AS total_amount, COUNT(*) AS transaction_count
      FROM transactions
      WHERE user_id = ? AND group_id IS NULL AND date >= ? AND date <= ?
      GROUP BY category, type
      ORDER BY total_amount DESC`;
    params = [options.userId ?? '', options.startDate ?? '0000-01-01', options.endDate ?? '9999-12-31'];
  }

  const { results } = await db.prepare(sql).bind(...params).all();
  return (results || []).map(row => ({
    category: String(row.category),
    type: row.type === 'income' ? 'income' : 'expense',
    total_amount: Number(row.total_amount),
    transaction_count: Number(row.transaction_count)
  }));
}

/**
 * Get expense summary broken down by group members
 */
export async function getGroupMemberSummary(
  db: D1Database,
  options: {
    groupId: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<MemberSummary[]> {
  const sql = `
    SELECT t.user_id AS line_user_id,
           COALESCE(up.first_name, 'สมาชิก') AS nickname,
           SUM(t.amount) AS total_paid,
           COUNT(*) AS transaction_count
    FROM transactions t
    LEFT JOIN user_profiles up ON up.user_id = t.user_id
    WHERE t.group_id = ? AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
    GROUP BY t.user_id, nickname
    ORDER BY total_paid DESC`;
  const params = [options.groupId, options.startDate ?? '0000-01-01', options.endDate ?? '9999-12-31'];

  const { results } = await db.prepare(sql).bind(...params).all();
  return (results || []).map(row => ({
    line_user_id: String(row.line_user_id),
    nickname: String(row.nickname),
    total_paid: Number(row.total_paid),
    transaction_count: Number(row.transaction_count)
  }));
}

/**
 * Slip extraction cache / dedup, stored in the existing slip_dedup_cache table.
 * Two key shapes are used by the webhook:
 *   "img:<sha256>" — extraction result of an identical slip image (24h TTL)
 *   "msg:<lineMessageId>" — marker that a LINE message was already handled
 */
const SLIP_CACHE_TTL_SECONDS = 60 * 60 * 24;

export async function getCachedExtraction(
  db: D1Database,
  hash: string,
  maxAgeSeconds: number = SLIP_CACHE_TTL_SECONDS
): Promise<SlipExtractionResult | null> {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  try {
    const row = await db
      .prepare('SELECT result_json FROM slip_dedup_cache WHERE hash = ? AND created_at >= ?')
      .bind(hash, cutoff)
      .first();
    if (!row || typeof row.result_json !== 'string') return null;
    return JSON.parse(row.result_json) as SlipExtractionResult;
  } catch {
    return null;
  }
}

export async function saveExtractionCache(
  db: D1Database,
  hash: string,
  result: SlipExtractionResult
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO slip_dedup_cache (hash, result_json, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(hash) DO UPDATE
         SET result_json = excluded.result_json, created_at = excluded.created_at`
    )
    .bind(hash, JSON.stringify(result), Math.floor(Date.now() / 1000))
    .run();
}

/** Observational history for the cold-start bootstrap — written on EVERY save. */
export async function recordSlipParties(
  db: D1Database, userId: string, txId: string,
  from: string | null, to: string | null, fromTails: string[], toTails: string[]
): Promise<void> {
  const rows: [string, string | null, string | null][] = [];
  const push = (side: 'from' | 'to', name: string | null, tails: string[]) => {
    const n = normalizeName(name || '');
    if (n) rows.push([side, n, null]);
    for (const t of new Set(tails.map(tail4).filter(x => x.length === 4))) rows.push([side, null, t]);
  };
  push('from', from, fromTails);
  push('to', to, toTails);
  if (!rows.length || !txId) return;
  await db.batch(rows.map(([side, n, t]) =>
    db.prepare('INSERT INTO slip_parties (user_id, tx_id, side, name_norm, tail) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, txId, side, n, t)));
}

/**
 * Atomic claim of a LINE message id BEFORE downloading the image — burst slips
 * and LINE redeliveries can no longer race past the old post-hoc msg: check.
 * The claim row expires in 10 minutes (created_at backdated 23h50m) so a
 * crashed pipeline still recovers on the next redelivery.
 */
export async function claimMessage(db: D1Database, messageId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const claimTs = now - (24 * 3600 - 600); // TTL window leaves 10 minutes
  const res = await db
    .prepare(
      `INSERT INTO slip_dedup_cache (hash, result_json, created_at)
       VALUES (?, '{}', ?) ON CONFLICT(hash) DO NOTHING`
    )
    .bind(`msg:${messageId}`, claimTs)
    .run();
  return Boolean((res as any).meta?.changes);
}
