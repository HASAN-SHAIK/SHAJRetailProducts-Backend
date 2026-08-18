ALTER TABLE IF EXISTS pos_sale_items
  ADD COLUMN IF NOT EXISTS taxable_minor BIGINT,
  ADD COLUMN IF NOT EXISTS gst_rate_bps BIGINT;

ALTER TABLE IF EXISTS order_items
  ADD COLUMN IF NOT EXISTS taxable_minor BIGINT,
  ADD COLUMN IF NOT EXISTS gst_rate_bps BIGINT;

ALTER TABLE IF EXISTS pos_sale_items
  DROP CONSTRAINT IF EXISTS chk_pos_sale_items_gst_rate_bps;

ALTER TABLE IF EXISTS pos_sale_items
  ADD CONSTRAINT chk_pos_sale_items_gst_rate_bps
  CHECK (gst_rate_bps IS NULL OR (gst_rate_bps >= 0 AND gst_rate_bps <= 10000));

ALTER TABLE IF EXISTS order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_gst_rate_bps;

ALTER TABLE IF EXISTS order_items
  ADD CONSTRAINT chk_order_items_gst_rate_bps
  CHECK (gst_rate_bps IS NULL OR (gst_rate_bps >= 0 AND gst_rate_bps <= 10000));
