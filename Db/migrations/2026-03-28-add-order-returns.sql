ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS returned_amount DECIMAL(12,2) DEFAULT 0;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'payment';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reference_id INT;

UPDATE transactions
SET transaction_type = 'payment'
WHERE transaction_type IS NULL;

CREATE TABLE IF NOT EXISTS order_returns (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INT,
  refund_total NUMERIC(10,2) NOT NULL,
  refund_mode TEXT NOT NULL,
  reason TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_return_items (
  id SERIAL PRIMARY KEY,
  return_id INT REFERENCES order_returns(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  quantity NUMERIC(10,2) NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(10,2) NOT NULL,
  gst_amount NUMERIC(10,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_order_returns_order
  ON order_returns (order_id);

CREATE INDEX IF NOT EXISTS idx_order_return_items_product
  ON order_return_items (product_id);

CREATE OR REPLACE FUNCTION refresh_order_total_paid(p_order_id INT) RETURNS VOID AS $$
DECLARE
  v_paid NUMERIC;
BEGIN
  SELECT COALESCE(SUM(total_price), 0)::numeric
  INTO v_paid
  FROM transactions
  WHERE order_id = p_order_id
    AND (transaction_type IS NULL OR transaction_type <> 'refund');

  UPDATE orders
  SET total_paid = COALESCE(v_paid, 0)
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;
