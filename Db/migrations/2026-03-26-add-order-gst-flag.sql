ALTER TABLE orders
ADD COLUMN IF NOT EXISTS is_gst_enabled BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders (created_at DESC);
