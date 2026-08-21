-- Preserve the distinct POS refund initiator relationship alongside manager approval.
-- Do not infer the initiating cashier/operator from the approver; older events may
-- legitimately have no initiator field and remain nullable for replay compatibility.

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS source_refunded_by_user_id TEXT;

ALTER TABLE IF EXISTS pos_partial_returns
  ADD COLUMN IF NOT EXISTS refunded_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_source_refunded_by_user_id
  ON orders(source_refunded_by_user_id)
  WHERE source_refunded_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source_refund_approved_by_user_id
  ON orders(source_refund_approved_by_user_id)
  WHERE source_refund_approved_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_partial_returns_refunded_by_user_id
  ON pos_partial_returns(refunded_by_user_id)
  WHERE refunded_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_partial_returns_approved_by_user_id
  ON pos_partial_returns(approved_by_user_id)
  WHERE approved_by_user_id IS NOT NULL;
