-- ====================================================================
-- Migration: 005_observability.sql (Cloudflare D1 / SQLite)
-- Description: Observability upgrade — structured request logs with a
--              correlation ID, pending-slip tracking, an audit trail for
--              data mutations, and structured (JSON) fields on system_events.
-- Run once:    npx wrangler d1 execute line-expense-db --remote --file migrations/005_observability.sql
-- Note:        ALTER TABLE ADD COLUMN is not idempotent in SQLite; if it
--              fails with "duplicate column name" the column already exists
--              and that statement can be skipped safely.
-- ====================================================================

-- Structured (grep/filter friendly) fields on the existing event log:
--   request_id = correlation ID tying every stage of one webhook event together
--   latency_ms = duration of the measured call
--   data       = structured JSON payload (metadata only, never full PII)
ALTER TABLE system_events ADD COLUMN request_id TEXT;
ALTER TABLE system_events ADD COLUMN latency_ms INTEGER;
ALTER TABLE system_events ADD COLUMN data TEXT;

-- One row per inbound webhook event: outcome + end-to-end latency.
--   outcome: 'processing' | 'success' | 'failed' | 'ignored'
CREATE TABLE IF NOT EXISTS request_logs (
  request_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  event_type TEXT NOT NULL,          -- 'message.image' | 'message.text' | 'postback' | ...
  user_hash TEXT,                    -- salted hash of the LINE userId (PDPA)
  group_id TEXT,
  message_id TEXT,
  outcome TEXT NOT NULL,
  latency_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_outcome_ts ON request_logs(outcome, ts DESC);

-- Slip pipeline checkpoint table: a slip that entered but never completed
-- (crash mid-pipeline, LLM timeout, DB write failure) stays 'pending' here
-- instead of disappearing silently.
CREATE TABLE IF NOT EXISTS pending_slips (
  message_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,               -- first seen
  updated_ts INTEGER NOT NULL,       -- last stage transition
  user_hash TEXT,
  stage TEXT NOT NULL,               -- 'received' | 'downloading' | 'extracting' | 'extracted' | 'saving' | 'saved' | 'replied' | 'not_slip'
  status TEXT NOT NULL               -- 'pending' | 'done' | 'failed'
);
CREATE INDEX IF NOT EXISTS idx_pending_slips_status ON pending_slips(status, updated_ts);

-- Who changed what, when (LIFF mutations: transactions, budgets, category rules).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,               -- LINE userId of the caller
  action TEXT NOT NULL,              -- 'create' | 'update' | 'delete' | 'set'
  entity TEXT NOT NULL,              -- 'transaction' | 'budget' | 'category_rule' | 'nickname'
  entity_id TEXT,
  detail TEXT                        -- JSON summary of the change (no balances history, just what/where)
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC);
