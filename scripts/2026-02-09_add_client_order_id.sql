ALTER TABLE orders
ADD COLUMN IF NOT EXISTS client_order_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_order_id_uniq
ON orders (client_order_id);
