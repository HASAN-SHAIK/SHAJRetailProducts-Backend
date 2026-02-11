-- =============================
-- DROP INDEXES
-- =============================

-- Users Indexes
DROP INDEX IF EXISTS idx_users_email;

-- Products Indexes
DROP INDEX IF EXISTS idx_products_name;
DROP INDEX IF EXISTS idx_products_category;

-- Orders Indexes
DROP INDEX IF EXISTS idx_orders_user_id;
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS orders_client_order_id_uniq;

-- Order Items Indexes
DROP INDEX IF EXISTS idx_order_items_order_id;
DROP INDEX IF EXISTS idx_order_items_product_id;

-- Transactions Indexes
DROP INDEX IF EXISTS idx_transactions_order_id;
DROP INDEX IF EXISTS idx_transactions_date;

-- =============================
-- DROP TABLES (IN DEPENDENCY ORDER)
-- =============================

DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS coupons CASCADE;
DROP TABLE IF EXISTS shop_details CASCADE;
DROP TABLE IF EXISTS users CASCADE;
