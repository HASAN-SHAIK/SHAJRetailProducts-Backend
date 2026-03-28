-- Billing Orders module tables (separate from existing orders tables)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS billing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number SERIAL,
  customer_id UUID NULL,
  total_amount NUMERIC,
  gst_amount NUMERIC,
  is_gst_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES billing_orders(id) ON DELETE CASCADE,
  product_id INT,
  quantity NUMERIC,
  price NUMERIC,
  gst_percentage NUMERIC,
  gst_amount NUMERIC,
  total NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_billing_orders_created_at
  ON billing_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_order_items_order_id
  ON billing_order_items (order_id);
