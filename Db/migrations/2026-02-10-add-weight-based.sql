ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_weight_based SMALLINT DEFAULT 0;

ALTER TABLE products
  ALTER COLUMN stock_quantity TYPE DECIMAL(10,2)
  USING stock_quantity::DECIMAL(10,2);

ALTER TABLE order_items
  ALTER COLUMN quantity TYPE DECIMAL(10,2)
  USING quantity::DECIMAL(10,2);
