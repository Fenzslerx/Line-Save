-- ====================================================================
-- Migration: d1_schema.sql (Cloudflare D1 / SQLite)
-- Description: Prepares the existing D1 database for the LINE bot.
--              The `transactions`, `user_profiles` tables already exist from
--              the previous deployment; this migration adds what is missing.
-- Run once:    npx wrangler d1 execute DB --remote --file migrations/d1_schema.sql
-- ====================================================================

-- Column for group chats (personal rows keep group_id NULL).
-- ALTER TABLE ADD COLUMN is not idempotent in SQLite; if it fails with
-- "duplicate column name" the migration has already been applied.
ALTER TABLE transactions ADD COLUMN group_id TEXT;

-- Index for group-scoped summaries
CREATE INDEX IF NOT EXISTS idx_transactions_group_date ON transactions(group_id, date);

-- Bot-owned table for LINE groups (separate from the legacy schema)
CREATE TABLE IF NOT EXISTS bot_groups (
  line_group_id TEXT PRIMARY KEY,
  group_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Slip extraction cache / message dedup (already exists on the live database)
CREATE TABLE IF NOT EXISTS slip_dedup_cache (
  hash TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
