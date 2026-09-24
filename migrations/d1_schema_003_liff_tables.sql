-- ====================================================================
-- Migration: d1_schema_003_liff_tables.sql (Cloudflare D1 / SQLite)
-- Description: Creates the budgets & category_rules tables used by the
--              LIFF dashboard. Split out of d1_schema.sql because that
--              file starts with a non-idempotent ALTER TABLE that fails
--              on databases that already ran it (D1 rolls back the whole
--              file, so the CREATEs after the ALTER never executed).
-- Run once:    npx wrangler d1 execute DB --remote --file migrations/d1_schema_003_liff_tables.sql
-- ====================================================================

-- Per-user monthly budget shown on the LIFF dashboard
CREATE TABLE IF NOT EXISTS budgets (
  user_id TEXT PRIMARY KEY,
  monthly_budget REAL NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- Keyword -> category auto-fill rules taught from the LIFF dashboard
CREATE TABLE IF NOT EXISTS category_rules (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  created_at TEXT DEFAULT (datetime('now'))
);
