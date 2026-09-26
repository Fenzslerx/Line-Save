-- ====================================================================
-- Migration: 008_slip_parties.sql (Cloudflare D1 / SQLite)
-- Description: Observational party history per transaction for the
--              direction engine v2 cold-start bootstrap (recurring-side
--              detection). Written on EVERY saved slip regardless of how
--              the direction was decided.
-- Run once:    npx wrangler d1 execute line-expense-db --remote --file migrations/008_slip_parties.sql
-- Safe to re-run.
-- ====================================================================

CREATE TABLE IF NOT EXISTS slip_parties (
  user_id TEXT NOT NULL,
  tx_id   TEXT NOT NULL,
  side    TEXT NOT NULL CHECK (side IN ('from','to')),
  name_norm TEXT,
  tail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_slip_parties_name ON slip_parties(user_id, side, name_norm);
CREATE INDEX IF NOT EXISTS idx_slip_parties_tail ON slip_parties(user_id, side, tail);
