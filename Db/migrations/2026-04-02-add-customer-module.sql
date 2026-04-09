-- Customer module schema updates
ALTER TABLE IF EXISTS customers
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT CHECK (type IN ('retail','wholesale')) DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS shop_name TEXT,
  ADD COLUMN IF NOT EXISTS gst_number TEXT,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_balance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');

CREATE TABLE IF NOT EXISTS customer_payments (
  id SERIAL PRIMARY KEY,
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_mode TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'retail';

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id
  ON customer_payments (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_type
  ON customers (type);

CREATE INDEX IF NOT EXISTS idx_customers_balance
  ON customers (current_balance);
