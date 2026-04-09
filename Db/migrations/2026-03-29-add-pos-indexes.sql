CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products (barcode);

CREATE INDEX IF NOT EXISTS idx_products_name_lower
  ON products (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_customers_name_lower
  ON customers (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_customers_mobile
  ON customers (mobile);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_branch_id
  ON orders (branch_id);
