-- Add customer_phone column to orders for backward compatibility
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- Optional backfill from customers.mobile for existing orders
UPDATE orders o
SET customer_phone = c.mobile
FROM customers c
WHERE o.customer_id = c.id
  AND o.customer_phone IS NULL;
