ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS source_refund_approved_by_user_id TEXT;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS source_refund_reason TEXT;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS source_returned_at TIMESTAMPTZ;
