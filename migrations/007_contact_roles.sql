-- ====================================================================
-- Migration: 007_contact_roles.sql (Cloudflare D1 / SQLite)
-- Description: contact_names v2 — one name can hold MULTIPLE roles
--              (expense payee / income payer / the user's own name).
--              The old table keyed a name to a single type, so roles
--              clobbered each other and direction inference misfired.
-- Run once:    npx wrangler d1 execute line-expense-db --remote --file migrations/007_contact_roles.sql
-- Safe to re-run.
-- ====================================================================

CREATE TABLE IF NOT EXISTS contact_names_v2 (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'self')),
  category TEXT,
  seen_count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, name, type)
);

-- Carry existing memories over (best effort; old rows keep their single type)
INSERT INTO contact_names_v2 (user_id, name, type, category, seen_count, first_seen, last_seen)
  SELECT user_id, name, type, category, seen_count, first_seen, last_seen
  FROM contact_names
  WHERE true
ON CONFLICT(user_id, name, type) DO UPDATE SET
  category = COALESCE(contact_names_v2.category, excluded.category),
  seen_count = MAX(contact_names_v2.seen_count, excluded.seen_count);

DROP TABLE IF EXISTS contact_names;
ALTER TABLE contact_names_v2 RENAME TO contact_names;
