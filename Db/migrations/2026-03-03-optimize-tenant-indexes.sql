-- Optimize tenant indexes for read-heavy dashboard + order listing while keeping write overhead low

-- Drop redundant/inefficient indexes
DROP INDEX IF EXISTS idx_orders_created_at;
DROP INDEX IF EXISTS idx_orders_customer_id;
DROP INDEX IF EXISTS idx_orders_location_created;
DROP INDEX IF EXISTS idx_orders_created_type_loc;
DROP INDEX IF EXISTS idx_transactions_created_order;
DROP INDEX IF EXISTS idx_transactions_order;
DROP INDEX IF EXISTS idx_transactions_payment_mode_created;
DROP INDEX IF EXISTS idx_products_not_deleted_stock;
DROP INDEX IF EXISTS idx_customers_location;

-- Ensure trigram extension for ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Orders: equality filters first, range/sort last
CREATE INDEX IF NOT EXISTS idx_orders_type_loc_created
  ON orders (transaction_type, location, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON orders (customer_id, created_at DESC);

-- Transactions: optimize joins + credit lookups
CREATE INDEX IF NOT EXISTS idx_transactions_order_created
  ON transactions (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_created
  ON transactions (payment_mode, created_at DESC)
  WHERE payment_mode = 'credit';

-- Order items
CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product
  ON order_items (product_id);

-- Products: search + low stock (partial index)
CREATE INDEX IF NOT EXISTS idx_products_category
  ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_low_stock
  ON products (stock_quantity)
  WHERE is_deleted = false;

-- Customers: search + new customers by date
CREATE INDEX IF NOT EXISTS idx_customers_created
  ON customers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);
