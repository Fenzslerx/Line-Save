-- ====================================================================
-- Migration: 006_contact_names.sql (Cloudflare D1 / SQLite)
-- Description: Remembers transfer counterparties per user (who sent
--              money to / received money from the user) so future slips
--              can reuse the category last used with that person.
-- Run once:    npx wrangler d1 execute line-expense-db --remote --file migrations/006_contact_names.sql
-- Note:        Idempotent (CREATE TABLE IF NOT EXISTS).
-- ====================================================================

CREATE TABLE IF NOT EXISTS contact_names (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT,
  seen_count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, name)
);
