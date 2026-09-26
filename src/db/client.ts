/**
 * Minimal typing for the Cloudflare D1 binding (kept local so we do not need
 * @cloudflare/workers-types to compile the Node/Express side).
 */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
  all(): Promise<{ results: any[]; success: boolean }>;
  first<T = any>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<{ success: boolean; meta?: { changes?: number } }[]>;
}

let d1: D1Database | null = null;

/**
 * Inject the D1 binding from the Worker entrypoint (src/worker.ts).
 * Must be called before handling the first request.
 */
export function setD1Database(db: D1Database): void {
  d1 = db;
}

export function getD1(): D1Database {
  if (!d1) {
    throw new Error('D1 database binding (DB) is not available. Call setD1Database() in the Worker entrypoint.');
  }
  return d1;
}

/**
 * Checks connectivity to the D1 database.
 */
export async function checkDatabaseConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getD1();
    const row = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")
      .first();
    if (!row) {
      return { ok: false, message: "D1 connected but the 'transactions' table is missing. Run migrations/d1_schema.sql." };
    }
    return { ok: true, message: 'D1 connected successfully.' };
  } catch (err: any) {
    return { ok: false, message: `D1 connection error: ${err?.message || err}` };
  }
}
