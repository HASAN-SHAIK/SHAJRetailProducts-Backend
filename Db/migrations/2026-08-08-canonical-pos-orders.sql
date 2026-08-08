-- Make the existing orders/order_items tables the canonical central sale model for POS-originated orders.
-- POS-specific projection tables remain temporarily for backward compatibility with payment,
-- receipt and inventory sync processors. Reporting and business workflows should use orders/order_items.

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS source_channel TEXT,
  ADD COLUMN IF NOT EXISTS source_order_id TEXT,
  ADD COLUMN IF NOT EXISTS source_store_id TEXT,
  ADD COLUMN IF NOT EXISTS source_terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS source_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS source_event_id TEXT,
  ADD COLUMN IF NOT EXISTS source_version INT,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8),
  ADD COLUMN IF NOT EXISTS subtotal_minor BIGINT,
  ADD COLUMN IF NOT EXISTS discount_minor BIGINT,
  ADD COLUMN IF NOT EXISTS tax_minor BIGINT,
  ADD COLUMN IF NOT EXISTS total_minor BIGINT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_source_identity
  ON orders(source_channel, source_order_id)
  WHERE source_channel IS NOT NULL AND source_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source_store_completed
  ON orders(source_store_id, completed_at DESC)
  WHERE source_store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source_terminal
  ON orders(source_terminal_id, completed_at DESC)
  WHERE source_terminal_id IS NOT NULL;

ALTER TABLE IF EXISTS order_items
  ADD COLUMN IF NOT EXISTS source_item_id TEXT,
  ADD COLUMN IF NOT EXISTS source_product_id TEXT,
  ADD COLUMN IF NOT EXISTS line_no INT,
  ADD COLUMN IF NOT EXISTS sku_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS barcode_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS quantity_milli BIGINT,
  ADD COLUMN IF NOT EXISTS unit_price_minor BIGINT,
  ADD COLUMN IF NOT EXISTS source_discount_minor BIGINT,
  ADD COLUMN IF NOT EXISTS tax_minor BIGINT,
  ADD COLUMN IF NOT EXISTS line_total_minor BIGINT,
  ADD COLUMN IF NOT EXISTS tax_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_items_source_item
  ON order_items(order_id, source_item_id)
  WHERE source_item_id IS NOT NULL;

-- Existing pos_sales rows can be retained as an integration projection during rollout.
-- New sale.completed events are written to orders/order_items by saleCompleted.processor.js.
