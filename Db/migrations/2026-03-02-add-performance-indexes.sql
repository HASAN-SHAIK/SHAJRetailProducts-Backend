-- Performance indexes for dashboard & order listing
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_created_type_loc
  ON orders (created_at, transaction_type, location);
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (order_status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON orders (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_location_created
  ON orders (location, created_at);

-- Transactions
CREATE INDEX IF NOT EXISTS idx_transactions_created_order
  ON transactions (created_at, order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_order
  ON transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_mode_created
  ON transactions (payment_mode, created_at);

-- Order items
CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product
  ON order_items (product_id);

-- Products
CREATE INDEX IF NOT EXISTS idx_products_not_deleted_stock
  ON products (is_deleted, stock_quantity);
CREATE INDEX IF NOT EXISTS idx_products_category
  ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);

-- Customers
CREATE INDEX IF NOT EXISTS idx_customers_created
  ON customers (created_at);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);
