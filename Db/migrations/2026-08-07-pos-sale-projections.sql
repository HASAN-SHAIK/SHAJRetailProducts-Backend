CREATE TABLE IF NOT EXISTS pos_sales (
  order_id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  terminal_id TEXT,
  customer_id TEXT,
  status TEXT NOT NULL,
  currency VARCHAR(8) NOT NULL,
  subtotal_minor BIGINT NOT NULL,
  discount_minor BIGINT NOT NULL,
  tax_minor BIGINT NOT NULL,
  total_minor BIGINT NOT NULL,
  notes TEXT,
  version INT NOT NULL,
  completed_at TIMESTAMPTZ,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  source_event_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_sale_items (
  item_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pos_sales(order_id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  product_id TEXT NOT NULL,
  sku TEXT,
  product_name TEXT NOT NULL,
  barcode TEXT,
  quantity_milli BIGINT NOT NULL,
  unit_price_minor BIGINT NOT NULL,
  discount_minor BIGINT NOT NULL,
  tax_minor BIGINT NOT NULL,
  line_total_minor BIGINT NOT NULL,
  tax_code TEXT,
  UNIQUE(order_id, line_no)
);

CREATE TABLE IF NOT EXISTS pos_sale_payments (
  payment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pos_sales(order_id) ON DELETE CASCADE,
  client_payment_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency VARCHAR(8) NOT NULL,
  status TEXT NOT NULL,
  reference TEXT,
  provider TEXT,
  source_created_at TIMESTAMPTZ,
  UNIQUE(order_id, client_payment_id)
);

CREATE TABLE IF NOT EXISTS pos_sale_receipts (
  receipt_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES pos_sales(order_id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  document_type TEXT NOT NULL,
  store_id TEXT NOT NULL,
  terminal_id TEXT,
  customer_id TEXT,
  currency VARCHAR(8) NOT NULL,
  total_minor BIGINT NOT NULL,
  paid_minor BIGINT NOT NULL,
  balance_minor BIGINT NOT NULL,
  snapshot_json JSONB NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pos_inventory_movements (
  movement_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pos_sales(order_id) ON DELETE CASCADE,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity_delta_milli BIGINT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  order_item_id TEXT,
  balance_after_milli BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pos_sales_store_completed ON pos_sales(store_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sale_items_order ON pos_sale_items(order_id, line_no);
CREATE INDEX IF NOT EXISTS idx_pos_sale_payments_order ON pos_sale_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_inventory_movements_order ON pos_inventory_movements(order_id, occurred_at);
