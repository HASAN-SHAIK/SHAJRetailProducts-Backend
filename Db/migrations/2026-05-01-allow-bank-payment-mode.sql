ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_mode_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_mode_check
  CHECK (payment_mode IN ('cash', 'online', 'bank', 'credit'));
