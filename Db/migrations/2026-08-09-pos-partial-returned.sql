-- Project item-level POS partial returns into the canonical sale without creating a second order model.
-- Detailed payment reversals and inventory restoration remain owned by their standalone event processors.

ALTER TABLE IF EXISTS order_items
  ADD COLUMN IF NOT EXISTS source_returned_quantity_milli BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_refunded_minor BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS pos_partial_returns (
  return_id TEXT PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_order_id TEXT NOT NULL,
  source_version INT NOT NULL,
  refund_minor BIGINT NOT NULL CHECK (refund_minor > 0),
  approved_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_returned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_partial_returns_order
  ON pos_partial_returns(order_id, source_version);

CREATE TABLE IF NOT EXISTS pos_partial_return_items (
  return_id TEXT NOT NULL REFERENCES pos_partial_returns(return_id) ON DELETE CASCADE,
  source_item_id TEXT NOT NULL,
  quantity_milli BIGINT NOT NULL CHECK (quantity_milli > 0),
  refund_minor BIGINT NOT NULL CHECK (refund_minor >= 0),
  PRIMARY KEY(return_id, source_item_id)
);
