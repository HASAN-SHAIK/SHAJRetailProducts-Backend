-- 2026-11-08-unreferenced-returns.sql
-- Enables walk-in / unreferenced sales returns without an original bill reference
-- Supports manager override return pricing, item condition grading (good vs damaged), and ledger credits

ALTER TABLE IF EXISTS order_returns
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE IF EXISTS order_returns
  ADD COLUMN IF NOT EXISTS is_unreferenced BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS manager_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

ALTER TABLE IF EXISTS order_return_items
  ADD COLUMN IF NOT EXISTS item_condition TEXT DEFAULT 'good',
  ADD COLUMN IF NOT EXISTS manager_override_price NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_order_returns_unreferenced
  ON order_returns(is_unreferenced) WHERE is_unreferenced = TRUE;

CREATE INDEX IF NOT EXISTS idx_order_returns_branch
  ON order_returns(branch_id);
