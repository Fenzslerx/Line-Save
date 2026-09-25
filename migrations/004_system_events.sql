-- ====================================================================
-- Migration: 004_system_events.sql (Cloudflare D1 / SQLite)
-- Description: Lightweight observability log for the admin dashboard.
--              One row per notable bot/liff/ai event (info/warn/error).
-- Run once:    npx wrangler d1 execute DB --remote --file migrations/004_system_events.sql
-- ====================================================================

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,              -- unix seconds
  level TEXT NOT NULL,              -- 'info' | 'warn' | 'error'
  source TEXT NOT NULL,             -- 'bot' | 'liff' | 'ai' | 'db' | 'system'
  event TEXT NOT NULL,              -- short machine name, e.g. 'slip_saved'
  detail TEXT                       -- human-readable message / error text
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON system_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_level_ts ON system_events(level, ts DESC);
