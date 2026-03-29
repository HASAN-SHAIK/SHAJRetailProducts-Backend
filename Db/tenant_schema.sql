CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR(50) CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS shop_details (
  id SERIAL PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255),
  mobile_number VARCHAR(15),
  gst_number VARCHAR(20),
  address_line TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  mobile VARCHAR(15),
  location VARCHAR(100),
  address TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  whatsapp_bill_module BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

ALTER TABLE IF EXISTS settings
  ADD COLUMN IF NOT EXISTS whatsapp_bill_module BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255),
  is_weight_based BOOLEAN DEFAULT FALSE,
  selling_price DECIMAL(10,2) NOT NULL,
  mrp DECIMAL(10,2),
  purchase_price DECIMAL(10,2),
  hsn_code VARCHAR(20),
  gst_percentage DECIMAL(5,2),
  is_batch_enabled BOOLEAN DEFAULT FALSE,
  stock_quantity DECIMAL(10,2) NOT NULL,
  company VARCHAR(255),
  barcode VARCHAR(50),
  branch_id UUID,
  time_for_delivery INT DEFAULT 0,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  expiry_date DATE
);

ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS branch_id UUID;

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT NULL,
  customer_id INT NULL,
  customer_phone TEXT,
  branch_id UUID,
  total_price DECIMAL(12,2),
  total_paid DECIMAL(12,2) DEFAULT 0,
  order_status VARCHAR(50) DEFAULT 'pending',
  transaction_type VARCHAR(10) DEFAULT 'sale' CHECK (transaction_type IN ('sale', 'purchase', 'personal')),
  location VARCHAR(255),
  product_summary TEXT,
  product_count INT DEFAULT 0,
  customer_name_snapshot TEXT,
  customer_mobile_snapshot TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  payment_mode VARCHAR(10) CHECK (payment_mode IN ('cash', 'online')),
  is_gst_enabled BOOLEAN DEFAULT TRUE

);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS branch_id UUID;

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT,
  product_id INT,
  quantity DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2),
  purchase_price_snapshot DECIMAL(10,2),
  discount_amount DECIMAL(10,2) DEFAULT 0,
  gst_percent DECIMAL(5,2) DEFAULT 0,
  profit DECIMAL(10,2) DEFAULT 0,
  margin_percent DECIMAL(10,2) DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  order_id INT,
  total_price DECIMAL(12,2),
  profit DECIMAL(12,2),
  payment_mode VARCHAR(50),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE OR REPLACE FUNCTION refresh_order_summary(p_order_id INT) RETURNS VOID AS $$
DECLARE
  v_names TEXT;
  v_count INT;
BEGIN
  SELECT
    STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name),
    COUNT(*)::int
  INTO v_names, v_count
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id;

  UPDATE orders
  SET product_summary = COALESCE(v_names, ''),
      product_count = COALESCE(v_count, 0)
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE FUNCTION trg_order_items_refresh_summary() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_order_summary(NEW.order_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM refresh_order_summary(OLD.order_id);
  ELSE
    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      PERFORM refresh_order_summary(OLD.order_id);
    END IF;
    PERFORM refresh_order_summary(NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_items_refresh_summary ON order_items;
CREATE TRIGGER order_items_refresh_summary
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION trg_order_items_refresh_summary();

CREATE OR REPLACE FUNCTION trg_transactions_refresh_total_paid() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_order_total_paid(NEW.order_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM refresh_order_total_paid(OLD.order_id);
  ELSE
    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      PERFORM refresh_order_total_paid(OLD.order_id);
    END IF;
    PERFORM refresh_order_total_paid(NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_refresh_total_paid ON transactions;
CREATE TRIGGER transactions_refresh_total_paid
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION trg_transactions_refresh_total_paid();

CREATE TABLE IF NOT EXISTS tenant_dashboard_metrics (
  day DATE NOT NULL,
  location TEXT,
  branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_profit NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_orders INT NOT NULL DEFAULT 0,
  credit_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (day, location, branch_id)
);

CREATE TABLE IF NOT EXISTS tenant_order_daily (
  day DATE NOT NULL,
  location TEXT,
  branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  order_id INT NOT NULL,
  PRIMARY KEY (day, location, branch_id, order_id)
);

CREATE TABLE IF NOT EXISTS tenant_product_daily (
  day DATE NOT NULL,
  location TEXT,
  branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  product_id INT NOT NULL,
  product_name TEXT,
  qty_sold NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (day, location, branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS tenant_customer_daily (
  day DATE NOT NULL,
  location TEXT,
  branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  customer_id INT NOT NULL,
  customer_name TEXT,
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_orders INT NOT NULL DEFAULT 0,
  credit_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (day, location, branch_id, customer_id)
);

CREATE TABLE IF NOT EXISTS tenant_customer_order_daily (
  day DATE NOT NULL,
  location TEXT,
  branch_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  customer_id INT NOT NULL,
  order_id INT NOT NULL,
  PRIMARY KEY (day, location, branch_id, customer_id, order_id)
);

ALTER TABLE IF EXISTS tenant_dashboard_metrics
  ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE IF EXISTS tenant_order_daily
  ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE IF EXISTS tenant_product_daily
  ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE IF EXISTS tenant_customer_daily
  ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE IF EXISTS tenant_customer_order_daily
  ADD COLUMN IF NOT EXISTS branch_id UUID;

UPDATE tenant_dashboard_metrics
  SET branch_id = COALESCE(branch_id, '00000000-0000-0000-0000-000000000000');
UPDATE tenant_order_daily
  SET branch_id = COALESCE(branch_id, '00000000-0000-0000-0000-000000000000');
UPDATE tenant_product_daily
  SET branch_id = COALESCE(branch_id, '00000000-0000-0000-0000-000000000000');
UPDATE tenant_customer_daily
  SET branch_id = COALESCE(branch_id, '00000000-0000-0000-0000-000000000000');
UPDATE tenant_customer_order_daily
  SET branch_id = COALESCE(branch_id, '00000000-0000-0000-0000-000000000000');

ALTER TABLE IF EXISTS tenant_dashboard_metrics
  DROP CONSTRAINT IF EXISTS tenant_dashboard_metrics_pkey;
ALTER TABLE IF EXISTS tenant_dashboard_metrics
  ADD PRIMARY KEY (day, location, branch_id);

ALTER TABLE IF EXISTS tenant_order_daily
  DROP CONSTRAINT IF EXISTS tenant_order_daily_pkey;
ALTER TABLE IF EXISTS tenant_order_daily
  ADD PRIMARY KEY (day, location, branch_id, order_id);

ALTER TABLE IF EXISTS tenant_product_daily
  DROP CONSTRAINT IF EXISTS tenant_product_daily_pkey;
ALTER TABLE IF EXISTS tenant_product_daily
  ADD PRIMARY KEY (day, location, branch_id, product_id);

ALTER TABLE IF EXISTS tenant_customer_daily
  DROP CONSTRAINT IF EXISTS tenant_customer_daily_pkey;
ALTER TABLE IF EXISTS tenant_customer_daily
  ADD PRIMARY KEY (day, location, branch_id, customer_id);

ALTER TABLE IF EXISTS tenant_customer_order_daily
  DROP CONSTRAINT IF EXISTS tenant_customer_order_daily_pkey;
ALTER TABLE IF EXISTS tenant_customer_order_daily
  ADD PRIMARY KEY (day, location, branch_id, customer_id, order_id);

CREATE OR REPLACE FUNCTION set_order_customer_snapshot() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    NEW.customer_name_snapshot := NULL;
    NEW.customer_mobile_snapshot := NULL;
    RETURN NEW;
  END IF;

  SELECT c.name, c.mobile
  INTO NEW.customer_name_snapshot, NEW.customer_mobile_snapshot
  FROM customers c
  WHERE c.id = NEW.customer_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_customer_snapshot_biu ON orders;
CREATE TRIGGER orders_customer_snapshot_biu
BEFORE INSERT OR UPDATE OF customer_id ON orders
FOR EACH ROW EXECUTE FUNCTION set_order_customer_snapshot();

CREATE OR REPLACE FUNCTION apply_order_item_metrics(
  p_order_id INT,
  p_product_id INT,
  p_qty NUMERIC,
  p_price NUMERIC,
  p_sign INT,
  p_location TEXT DEFAULT NULL,
  p_transaction_type TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_day DATE;
  v_location TEXT;
  v_type TEXT;
  v_product_name TEXT;
  v_branch UUID;
BEGIN
  SELECT o.created_at, o.location, o.transaction_type, o.branch_id
  INTO v_day, v_location, v_type, v_branch
  FROM orders o
  WHERE o.id = p_order_id;

  IF p_location IS NOT NULL THEN
    v_location := p_location;
  END IF;
  IF p_transaction_type IS NOT NULL THEN
    v_type := p_transaction_type;
  END IF;
  IF p_branch_id IS NOT NULL THEN
    v_branch := p_branch_id;
  END IF;

  v_day := DATE(v_day);
  v_location := NULLIF(BTRIM(v_location), '');
  IF v_location IS NULL THEN
    v_location := 'Unknown';
  END IF;
  v_branch := COALESCE(v_branch, '00000000-0000-0000-0000-000000000000');

  IF v_type IS DISTINCT FROM 'sale' THEN
    RETURN;
  END IF;

  SELECT p.name INTO v_product_name FROM products p WHERE p.id = p_product_id;

  INSERT INTO tenant_product_daily (day, location, branch_id, product_id, product_name, qty_sold, revenue)
  VALUES (
    v_day,
    v_location,
    v_branch,
    p_product_id,
    v_product_name,
    p_sign * COALESCE(p_qty, 0),
    p_sign * COALESCE(p_qty, 0) * COALESCE(p_price, 0)
  )
  ON CONFLICT (day, location, branch_id, product_id) DO UPDATE
  SET qty_sold = tenant_product_daily.qty_sold + EXCLUDED.qty_sold,
      revenue = tenant_product_daily.revenue + EXCLUDED.revenue,
      product_name = COALESCE(EXCLUDED.product_name, tenant_product_daily.product_name),
      updated_at = (NOW() AT TIME ZONE 'UTC');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_order_items_metrics() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM apply_order_item_metrics(NEW.order_id, NEW.product_id, NEW.quantity, NEW.selling_price, 1);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM apply_order_item_metrics(OLD.order_id, OLD.product_id, OLD.quantity, OLD.selling_price, -1);
  ELSE
    PERFORM apply_order_item_metrics(OLD.order_id, OLD.product_id, OLD.quantity, OLD.selling_price, -1);
    PERFORM apply_order_item_metrics(NEW.order_id, NEW.product_id, NEW.quantity, NEW.selling_price, 1);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_items_metrics_aiud ON order_items;
CREATE TRIGGER order_items_metrics_aiud
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION trg_order_items_metrics();

CREATE OR REPLACE FUNCTION apply_txn_metrics(
  p_order_id INT,
  p_created_at TIMESTAMP,
  p_total_price NUMERIC,
  p_profit NUMERIC,
  p_payment_mode TEXT,
  p_sign INT,
  p_location TEXT DEFAULT NULL,
  p_transaction_type TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_day DATE;
  v_location TEXT;
  v_type TEXT;
  v_credit NUMERIC := 0;
  v_customer_id INT;
  v_customer_name TEXT;
  v_branch UUID;
BEGIN
  v_day := DATE(p_created_at);

  IF p_location IS NULL OR p_transaction_type IS NULL THEN
    SELECT o.location, o.transaction_type, o.customer_id, o.customer_name_snapshot, o.branch_id
    INTO v_location, v_type, v_customer_id, v_customer_name, v_branch
    FROM orders o
    WHERE o.id = p_order_id;
  ELSE
    v_location := p_location;
    v_type := p_transaction_type;
    SELECT o.customer_id, o.customer_name_snapshot, o.branch_id
    INTO v_customer_id, v_customer_name, v_branch
    FROM orders o
    WHERE o.id = p_order_id;
  END IF;
  IF p_branch_id IS NOT NULL THEN
    v_branch := p_branch_id;
  END IF;

  v_location := NULLIF(BTRIM(v_location), '');
  IF v_location IS NULL THEN
    v_location := 'Unknown';
  END IF;
  v_branch := COALESCE(v_branch, '00000000-0000-0000-0000-000000000000');

  IF v_type IS DISTINCT FROM 'sale' THEN
    RETURN;
  END IF;

  IF p_payment_mode = 'credit' THEN
    v_credit := COALESCE(p_total_price, 0);
  END IF;

  INSERT INTO tenant_dashboard_metrics (day, location, branch_id, total_revenue, total_profit, total_orders, credit_outstanding)
  VALUES (
    v_day,
    v_location,
    v_branch,
    p_sign * COALESCE(p_total_price, 0),
    p_sign * COALESCE(p_profit, 0),
    0,
    p_sign * COALESCE(v_credit, 0)
  )
  ON CONFLICT (day, location, branch_id) DO UPDATE
  SET total_revenue = tenant_dashboard_metrics.total_revenue + EXCLUDED.total_revenue,
      total_profit = tenant_dashboard_metrics.total_profit + EXCLUDED.total_profit,
      credit_outstanding = tenant_dashboard_metrics.credit_outstanding + EXCLUDED.credit_outstanding,
      updated_at = (NOW() AT TIME ZONE 'UTC');

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO tenant_customer_daily (day, location, branch_id, customer_id, customer_name, total_revenue, total_orders, credit_outstanding)
    VALUES (
      v_day,
      v_location,
      v_branch,
      v_customer_id,
      v_customer_name,
      p_sign * COALESCE(p_total_price, 0),
      0,
      p_sign * COALESCE(v_credit, 0)
    )
    ON CONFLICT (day, location, branch_id, customer_id) DO UPDATE
    SET total_revenue = tenant_customer_daily.total_revenue + EXCLUDED.total_revenue,
        credit_outstanding = tenant_customer_daily.credit_outstanding + EXCLUDED.credit_outstanding,
        customer_name = COALESCE(EXCLUDED.customer_name, tenant_customer_daily.customer_name),
        updated_at = (NOW() AT TIME ZONE 'UTC');
  END IF;

  IF p_sign > 0 THEN
    INSERT INTO tenant_order_daily (day, location, branch_id, order_id)
    VALUES (v_day, v_location, v_branch, p_order_id)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE tenant_dashboard_metrics
      SET total_orders = total_orders + 1,
          updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND branch_id = v_branch;
    END IF;

    IF v_customer_id IS NOT NULL THEN
      INSERT INTO tenant_customer_order_daily (day, location, branch_id, customer_id, order_id)
      VALUES (v_day, v_location, v_branch, v_customer_id, p_order_id)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN
        UPDATE tenant_customer_daily
        SET total_orders = total_orders + 1,
            updated_at = (NOW() AT TIME ZONE 'UTC')
        WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND branch_id = v_branch AND customer_id = v_customer_id;
      END IF;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM transactions t
      WHERE t.order_id = p_order_id
        AND DATE(t.created_at) = v_day
    ) THEN
      DELETE FROM tenant_order_daily
      WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND branch_id = v_branch AND order_id = p_order_id;
      UPDATE tenant_dashboard_metrics
      SET total_orders = GREATEST(total_orders - 1, 0),
          updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND branch_id = v_branch;

      IF v_customer_id IS NOT NULL THEN
        DELETE FROM tenant_customer_order_daily
        WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND branch_id = v_branch AND customer_id = v_customer_id AND order_id = p_order_id;
        UPDATE tenant_customer_daily
        SET total_orders = GREATEST(total_orders - 1, 0),
            updated_at = (NOW() AT TIME ZONE 'UTC')
        WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND branch_id = v_branch AND customer_id = v_customer_id;
      END IF;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_transactions_metrics() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM apply_txn_metrics(NEW.order_id, NEW.created_at, NEW.total_price, NEW.profit, NEW.payment_mode, 1);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM apply_txn_metrics(OLD.order_id, OLD.created_at, OLD.total_price, OLD.profit, OLD.payment_mode, -1);
  ELSE
    PERFORM apply_txn_metrics(OLD.order_id, OLD.created_at, OLD.total_price, OLD.profit, OLD.payment_mode, -1);
    PERFORM apply_txn_metrics(NEW.order_id, NEW.created_at, NEW.total_price, NEW.profit, NEW.payment_mode, 1);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_metrics_aiud ON transactions;
CREATE TRIGGER transactions_metrics_aiud
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION trg_transactions_metrics();

CREATE OR REPLACE FUNCTION trg_orders_metrics_relocate() RETURNS TRIGGER AS $$
DECLARE
  t RECORD;
BEGIN
  IF (OLD.location IS DISTINCT FROM NEW.location)
     OR (OLD.transaction_type IS DISTINCT FROM NEW.transaction_type)
     OR (OLD.branch_id IS DISTINCT FROM NEW.branch_id) THEN
    FOR t IN SELECT * FROM transactions WHERE order_id = NEW.id LOOP
      PERFORM apply_txn_metrics(t.order_id, t.created_at, t.total_price, t.profit, t.payment_mode, -1, OLD.location, OLD.transaction_type, OLD.branch_id);
      PERFORM apply_txn_metrics(t.order_id, t.created_at, t.total_price, t.profit, t.payment_mode, 1, NEW.location, NEW.transaction_type, NEW.branch_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_metrics_relocate ON orders;
CREATE TRIGGER orders_metrics_relocate
AFTER UPDATE OF location, transaction_type, branch_id ON orders
FOR EACH ROW EXECUTE FUNCTION trg_orders_metrics_relocate();

CREATE OR REPLACE FUNCTION trg_orders_relocate_product_metrics() RETURNS TRIGGER AS $$
DECLARE
  i RECORD;
BEGIN
  IF (OLD.location IS DISTINCT FROM NEW.location)
     OR (OLD.transaction_type IS DISTINCT FROM NEW.transaction_type)
     OR (OLD.branch_id IS DISTINCT FROM NEW.branch_id) THEN
    FOR i IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
      PERFORM apply_order_item_metrics(i.order_id, i.product_id, i.quantity, i.selling_price, -1, OLD.location, OLD.transaction_type, OLD.branch_id);
      PERFORM apply_order_item_metrics(i.order_id, i.product_id, i.quantity, i.selling_price, 1, NEW.location, NEW.transaction_type, NEW.branch_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_relocate_product_metrics ON orders;
CREATE TRIGGER orders_relocate_product_metrics
AFTER UPDATE OF location, transaction_type, branch_id ON orders
FOR EACH ROW EXECUTE FUNCTION trg_orders_relocate_product_metrics();

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_type_loc_created
  ON orders (transaction_type, location, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_location
  ON orders (location)
  WHERE location IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_order_created
  ON transactions (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_created
  ON transactions (payment_mode, created_at DESC)
  WHERE payment_mode = 'credit';

CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product
  ON order_items (product_id);

CREATE INDEX IF NOT EXISTS idx_products_category
  ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_branch
  ON products (branch_id);
CREATE INDEX IF NOT EXISTS idx_products_name
  ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_active_created_at
  ON products (created_at DESC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_products_active_category_created
  ON products (category, created_at DESC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_company_trgm
  ON products USING gin (company gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_active
  ON products (barcode)
  WHERE is_deleted = false AND barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_low_stock
  ON products (stock_quantity)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_customers_created
  ON customers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);

-- Performance additions (mobile/pos critical)
CREATE INDEX IF NOT EXISTS idx_products_barcode_lookup
  ON products (barcode)
  INCLUDE (id, name, company, selling_price, stock_quantity)
  WHERE is_deleted = FALSE AND barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_active
  ON products (category)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm_active
  ON products USING gin (name gin_trgm_ops)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_company_trgm_active
  ON products USING gin (company gin_trgm_ops)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_branch_created
  ON orders (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_created
  ON transactions (created_at DESC);
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

-- Expenses module
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT,
  name TEXT,
  amount NUMERIC,
  description TEXT,
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  branch_id UUID
);

ALTER TABLE IF EXISTS expenses
  ADD COLUMN IF NOT EXISTS branch_id UUID;

CREATE TABLE IF NOT EXISTS hsn_gst (
  hsn_code TEXT PRIMARY KEY,
  gst_percentage NUMERIC,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE hsn_gst
  ADD COLUMN IF NOT EXISTS description TEXT;

INSERT INTO hsn_gst (hsn_code, gst_percentage, description) VALUES
('9405', 12, 'Lighting products'),
('3004', 12, 'Medicaments'),
('8517', 18, 'Mobile phones'),
('2106', 18, 'Food preparations'),
('1001', 5, 'Wheat'),
('2710', 18, 'Petroleum oils')
ON CONFLICT (hsn_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_expenses_date
  ON expenses (date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_type_date
  ON expenses (type, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date
  ON expenses (branch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_billing_order_items_order_id
  ON billing_order_items (order_id);

-- Branches (multi-store)
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  subscription_plan TEXT DEFAULT 'basic',
  max_devices_allowed INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS max_devices_allowed INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS branch_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  user_id INT,
  device_id TEXT NOT NULL,
  device_name TEXT,
  browser_info TEXT,
  os_info TEXT,
  ip_address TEXT,
  last_login_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_devices_branch_device
  ON branch_devices (branch_id, device_id);

CREATE TABLE IF NOT EXISTS branch_device_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  user_id INT,
  device_id TEXT,
  action TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  batch_number TEXT,
  expiry_date DATE,
  purchase_price NUMERIC,
  selling_price NUMERIC,
  quantity NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS branch_id UUID;

CREATE INDEX IF NOT EXISTS idx_batches_product_branch
  ON batches (product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry
  ON batches (expiry_date ASC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS returned_amount DECIMAL(12,2) DEFAULT 0;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'payment';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reference_id INT;

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

  INSERT INTO hsn_gst (hsn_code, gst_percentage) VALUES
-- Food & Grocery
('1001', 5), ('1006', 5), ('1101', 5), ('1102', 5),
('1701', 5), ('1702', 5), ('1905', 5),

-- FMCG
('2106', 18), ('3303', 18), ('3304', 18), ('3401', 18),

-- Pharma
('3004', 12), ('3003', 12),

-- Electronics
('8517', 18), ('8528', 18), ('8471', 18), ('8504', 18),

-- Lighting
('9405', 12), ('9405.10', 12), ('9405.20', 12),
('8539', 12), ('8513', 18),

-- Oil & Lubricants
('2710', 18), ('2710.19', 18),

-- Textiles
('6101', 5), ('6201', 5), ('6110', 5),

-- Plastics
('3923', 18), ('3924', 18),

-- Stationery
('4820', 12), ('9608', 18),

-- Hardware
 ('8201', 18), ('7318', 18)
ON CONFLICT (hsn_code) DO NOTHING;
