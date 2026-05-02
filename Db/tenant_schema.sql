CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR(50) CHECK (role IN ('admin', 'staff')),
  branch_id UUID,
  all_branch_access BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS all_branch_access BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS shop_details (
  id SERIAL PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255),
  mobile_number VARCHAR(15),
  upi_id VARCHAR(100),
  gst_number VARCHAR(20),
  address_line TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

ALTER TABLE IF EXISTS shop_details
  ADD COLUMN IF NOT EXISTS upi_id VARCHAR(100);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  mobile VARCHAR(15),
  phone TEXT,
  type TEXT CHECK (type IN ('retail','wholesale')) DEFAULT 'retail',
  email TEXT,
  location VARCHAR(100),
  address TEXT,
  shop_name TEXT,
  gst_number TEXT,
  credit_limit NUMERIC DEFAULT 0,
  current_balance NUMERIC DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  whatsapp_bill_module BOOLEAN DEFAULT FALSE,
  is_opening_completed BOOLEAN DEFAULT FALSE,
  opening_completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

ALTER TABLE IF EXISTS settings
  ADD COLUMN IF NOT EXISTS whatsapp_bill_module BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS settings
  ADD COLUMN IF NOT EXISTS is_opening_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS settings
  ADD COLUMN IF NOT EXISTS opening_completed_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS opening_setup (
  id SERIAL PRIMARY KEY,
  cash_amount NUMERIC NOT NULL DEFAULT 0,
  bank_amount NUMERIC NOT NULL DEFAULT 0,
  inventory_value NUMERIC NOT NULL DEFAULT 0,
  total_capital NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

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
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  expiry_date DATE
);

ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');
ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Suppliers (Purchase Management)
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mobile VARCHAR(15),
  email TEXT,
  address TEXT,
  gst_number TEXT,
  credit_limit NUMERIC DEFAULT 0,
  current_balance NUMERIC DEFAULT 0,
  branch_id UUID,
  is_active BOOLEAN DEFAULT TRUE,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  supplier_id INT REFERENCES suppliers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_mode TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

ALTER TABLE IF EXISTS suppliers
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS suppliers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');

CREATE INDEX IF NOT EXISTS idx_suppliers_branch
  ON suppliers (branch_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower
  ON suppliers (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier
  ON supplier_payments (supplier_id);

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
  billing_type TEXT DEFAULT 'retail',
  location VARCHAR(255),
  product_summary TEXT,
  product_count INT DEFAULT 0,
  customer_name_snapshot TEXT,
  customer_mobile_snapshot TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  is_deleted BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  payment_mode VARCHAR(10) CHECK (payment_mode IN ('cash', 'online', 'bank', 'credit')),
  is_gst_enabled BOOLEAN DEFAULT TRUE,
  gst_mode VARCHAR(20) DEFAULT 'INCLUSIVE'

);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_mode_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_mode_check
  CHECK (payment_mode IN ('cash', 'online', 'bank', 'credit'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gst_mode VARCHAR(20) DEFAULT 'INCLUSIVE';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS supplier_id INT REFERENCES suppliers(id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_order_id TEXT;
ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');
ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

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
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

ALTER TABLE IF EXISTS order_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  order_id INT,
  total_price DECIMAL(12,2),
  profit DECIMAL(12,2),
  payment_mode VARCHAR(50),
  amount NUMERIC,
  party_type TEXT,
  party_id INT,
  direction TEXT,
  txn_type TEXT,
  notes TEXT,
  branch_id UUID,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id SERIAL PRIMARY KEY,
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_mode TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = (NOW() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_order_items_updated_at ON order_items;
CREATE TRIGGER trg_order_items_updated_at
BEFORE UPDATE ON order_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;
CREATE TRIGGER trg_suppliers_updated_at
BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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
CREATE INDEX IF NOT EXISTS idx_orders_supplier_created
  ON orders (supplier_id, created_at DESC)
  WHERE transaction_type = 'purchase';
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
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_order_id_uniq
  ON orders (client_order_id)
  WHERE client_order_id IS NOT NULL;

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
  category TEXT,
  staff_id UUID,
  payment_method TEXT,
  notes TEXT,
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  branch_id UUID
);

ALTER TABLE IF EXISTS expenses
  ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE IF EXISTS expenses
  ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE IF EXISTS expenses
  ADD COLUMN IF NOT EXISTS staff_id UUID;
ALTER TABLE IF EXISTS expenses
  ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE IF EXISTS expenses
  ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');

CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT,
  salary NUMERIC,
  join_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  branch_id UUID
);

CREATE INDEX IF NOT EXISTS idx_staff_name
  ON staff (name);
CREATE INDEX IF NOT EXISTS idx_staff_branch
  ON staff (branch_id);

CREATE TABLE IF NOT EXISTS salaries (
  id UUID PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  month TEXT,
  base_salary NUMERIC,
  bonus NUMERIC,
  deductions NUMERIC,
  net_salary NUMERIC,
  paid_amount NUMERIC,
  pending_amount NUMERIC,
  payment_status TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  branch_id UUID
);

CREATE INDEX IF NOT EXISTS idx_salaries_staff_month
  ON salaries (staff_id, month);
CREATE INDEX IF NOT EXISTS idx_salaries_branch
  ON salaries (branch_id);

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

ALTER TABLE IF EXISTS customers
  ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS merged_into_id INT REFERENCES customers(id);

ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS merged_into_id INT REFERENCES products(id);

CREATE TABLE IF NOT EXISTS dedupe_merge_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'product')),
  primary_id INT NOT NULL,
  secondary_id INT NOT NULL,
  merged_by_user_id INT,
  merged_by_role TEXT,
  merge_reason TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id UUID,
  branch_id UUID,
  actor_user_id INT,
  actor_role TEXT,
  actor_name TEXT,
  reason TEXT NOT NULL DEFAULT 'correction',
  source_type TEXT NOT NULL DEFAULT 'system',
  reference_id TEXT,
  delta_quantity NUMERIC DEFAULT 0,
  before_quantity NUMERIC,
  after_quantity NUMERIC,
  delta_purchase_price NUMERIC DEFAULT 0,
  before_purchase_price NUMERIC,
  after_purchase_price NUMERIC,
  delta_selling_price NUMERIC DEFAULT 0,
  before_selling_price NUMERIC,
  after_selling_price NUMERIC,
  note TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_product_created
  ON stock_audit_logs (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stock_consistency_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  auto_heal_enabled BOOLEAN DEFAULT TRUE,
  source TEXT DEFAULT 'manual',
  triggered_by TEXT,
  mismatch_count INT DEFAULT 0,
  healed_count INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_consistency_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES stock_consistency_runs(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT,
  product_stock_quantity NUMERIC NOT NULL,
  batches_total_quantity NUMERIC NOT NULL,
  delta_quantity NUMERIC NOT NULL,
  healed BOOLEAN DEFAULT FALSE,
  heal_target_quantity NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_consistency_items_run
  ON stock_consistency_run_items (run_id, created_at DESC);

CREATE OR REPLACE FUNCTION log_product_stock_change() RETURNS TRIGGER AS $$
DECLARE
  resolved_reason TEXT;
  resolved_source TEXT;
  resolved_reference TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       COALESCE(OLD.stock_quantity, 0) <> COALESCE(NEW.stock_quantity, 0)
       OR COALESCE(OLD.purchase_price, 0) <> COALESCE(NEW.purchase_price, 0)
       OR COALESCE(OLD.selling_price, 0) <> COALESCE(NEW.selling_price, 0)
     ) THEN
    resolved_reason := COALESCE(NULLIF(current_setting('app.stock_reason', true), ''), 'correction');
    resolved_source := COALESCE(NULLIF(current_setting('app.stock_source', true), ''), 'system');
    resolved_reference := NULLIF(current_setting('app.stock_reference', true), '');

    INSERT INTO stock_audit_logs (
      product_id,
      branch_id,
      actor_user_id,
      actor_role,
      actor_name,
      reason,
      source_type,
      reference_id,
      delta_quantity,
      before_quantity,
      after_quantity,
      delta_purchase_price,
      before_purchase_price,
      after_purchase_price,
      delta_selling_price,
      before_selling_price,
      after_selling_price
    ) VALUES (
      NEW.id,
      NEW.branch_id,
      NULLIF(current_setting('app.actor_user_id', true), '')::INT,
      NULLIF(current_setting('app.actor_role', true), ''),
      NULLIF(current_setting('app.actor_name', true), ''),
      resolved_reason,
      resolved_source,
      resolved_reference,
      COALESCE(NEW.stock_quantity, 0) - COALESCE(OLD.stock_quantity, 0),
      OLD.stock_quantity,
      NEW.stock_quantity,
      COALESCE(NEW.purchase_price, 0) - COALESCE(OLD.purchase_price, 0),
      OLD.purchase_price,
      NEW.purchase_price,
      COALESCE(NEW.selling_price, 0) - COALESCE(OLD.selling_price, 0),
      OLD.selling_price,
      NEW.selling_price
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_stock_audit ON products;
CREATE TRIGGER trg_products_stock_audit
AFTER UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION log_product_stock_change();

CREATE INDEX IF NOT EXISTS idx_expenses_date
  ON expenses (date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_type_date
  ON expenses (type, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date
  ON expenses (branch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_staff_date
  ON expenses (staff_id, date DESC);
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
  mrp NUMERIC,
  quantity NUMERIC NOT NULL DEFAULT 0,
  quantity_remaining NUMERIC,
  purchase_order_id INT REFERENCES orders(id),
  sync_version INT DEFAULT 1,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS branch_id UUID;

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS quantity_remaining NUMERIC;
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS mrp NUMERIC;

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS purchase_order_id INT REFERENCES orders(id);
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS sync_version INT DEFAULT 1;
ALTER TABLE IF EXISTS batches
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS batches
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');

DROP TRIGGER IF EXISTS trg_batches_updated_at ON batches;
CREATE TRIGGER trg_batches_updated_at
BEFORE UPDATE ON batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION bump_batch_sync_version() RETURNS TRIGGER AS $$
BEGIN
  NEW.sync_version = COALESCE(OLD.sync_version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_batches_sync_version ON batches;
CREATE TRIGGER trg_batches_sync_version
BEFORE UPDATE ON batches
FOR EACH ROW EXECUTE FUNCTION bump_batch_sync_version();

UPDATE batches
  SET quantity_remaining = quantity
  WHERE quantity_remaining IS NULL;
UPDATE batches
  SET sync_version = COALESCE(sync_version, 1);

UPDATE products
  SET updated_at = COALESCE(updated_at, created_at, (NOW() AT TIME ZONE 'UTC'));
UPDATE suppliers
  SET updated_at = COALESCE(updated_at, created_at, (NOW() AT TIME ZONE 'UTC'));
UPDATE orders
  SET updated_at = COALESCE(updated_at, created_at, (NOW() AT TIME ZONE 'UTC'));
UPDATE order_items
  SET updated_at = COALESCE(updated_at, (NOW() AT TIME ZONE 'UTC'));
UPDATE batches
  SET updated_at = COALESCE(updated_at, created_at, (NOW() AT TIME ZONE 'UTC'));

UPDATE products
  SET is_deleted = COALESCE(is_deleted, FALSE);
UPDATE suppliers
  SET is_deleted = COALESCE(is_deleted, FALSE);
UPDATE orders
  SET is_deleted = COALESCE(is_deleted, FALSE);
UPDATE batches
  SET is_deleted = COALESCE(is_deleted, FALSE);

CREATE INDEX IF NOT EXISTS idx_batches_product_branch
  ON batches (product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry
  ON batches (expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_batches_purchase_order
  ON batches (purchase_order_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_audit_logs_batch_id_fkey'
      AND conrelid = 'stock_audit_logs'::regclass
  ) THEN
    ALTER TABLE stock_audit_logs
      ADD CONSTRAINT stock_audit_logs_batch_id_fkey
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_audit_logs_branch_id_fkey'
      AND conrelid = 'stock_audit_logs'::regclass
  ) THEN
    ALTER TABLE stock_audit_logs
      ADD CONSTRAINT stock_audit_logs_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS returned_amount DECIMAL(12,2) DEFAULT 0;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'payment';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reference_id INT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS amount NUMERIC;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS party_type TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS party_id INT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS direction TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS txn_type TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID;

CREATE TABLE IF NOT EXISTS order_returns (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INT,
  refund_total NUMERIC(10,2) NOT NULL,
  refund_mode TEXT NOT NULL,
  reason TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT NOW(),
  return_uuid UUID UNIQUE,
  tax_reversed NUMERIC,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- Purchase returns (separate from sales returns)
CREATE TABLE IF NOT EXISTS purchase_returns (
  id SERIAL PRIMARY KEY,
  purchase_id INT REFERENCES orders(id),
  supplier_id INT REFERENCES suppliers(id),
  total_amount NUMERIC,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id SERIAL PRIMARY KEY,
  purchase_return_id INT REFERENCES purchase_returns(id),
  batch_id UUID REFERENCES batches(id),
  product_id INT,
  quantity NUMERIC,
  amount NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase
  ON purchase_returns (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier
  ON purchase_returns (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return
  ON purchase_return_items (purchase_return_id);

-- Purchase Requests (supplier email workflow)
CREATE TABLE IF NOT EXISTS purchase_requests (
  id SERIAL PRIMARY KEY,
  supplier_id INT REFERENCES suppliers(id),
  branch_id UUID,
  status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'COMPLETED')),
  expected_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_request_items (
  id SERIAL PRIMARY KEY,
  purchase_request_id INT REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  quantity NUMERIC NOT NULL,
  last_purchase_price NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_supplier
  ON purchase_requests (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_branch
  ON purchase_requests (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_request
  ON purchase_request_items (purchase_request_id);

CREATE TABLE IF NOT EXISTS order_return_items (
  id SERIAL PRIMARY KEY,
  return_id INT REFERENCES order_returns(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  batch_id UUID,
  quantity NUMERIC(10,2) NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(10,2) NOT NULL,
  gst_amount NUMERIC(10,2) DEFAULT 0
);

ALTER TABLE IF EXISTS order_return_items
  ADD COLUMN IF NOT EXISTS batch_id UUID;

ALTER TABLE IF EXISTS order_items
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE TABLE IF NOT EXISTS bill_corrections (
  id UUID PRIMARY KEY,
  bill_id INT REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT,
  changes JSONB,
  adjusted_amount NUMERIC,
  tax_adjustment NUMERIC,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  is_synced BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_bill_corrections_bill
  ON bill_corrections (bill_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gst_ledger (
  id UUID PRIMARY KEY,
  bill_id INT REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT,
  taxable_amount NUMERIC,
  cgst NUMERIC,
  sgst NUMERIC,
  igst NUMERIC,
  total_tax NUMERIC,
  date DATE,
  is_synced BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_gst_ledger_bill
  ON gst_ledger (bill_id, date DESC);

CREATE TABLE IF NOT EXISTS eway_bills (
  id UUID PRIMARY KEY,
  bill_id INT REFERENCES orders(id) ON DELETE CASCADE,
  transport_details TEXT,
  distance NUMERIC,
  gstin TEXT,
  generated_number TEXT,
  status TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  is_synced BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_eway_bill
  ON eway_bills (bill_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_returns_order
  ON order_returns (order_id);

CREATE INDEX IF NOT EXISTS idx_order_return_items_product
  ON order_return_items (product_id);

CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products (barcode);

CREATE INDEX IF NOT EXISTS idx_products_name_lower
  ON products (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_customers_name_lower
  ON customers (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_customers_mobile
  ON customers (mobile);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_branch_id
  ON orders (branch_id);

-- Double-entry ledger foundation (kept in tenant schema for new tenant bootstrap)
CREATE TABLE IF NOT EXISTS ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE')),
  parent_id UUID NULL REFERENCES ledgers(id),
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  branch_id UUID NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledgers_name_branch
  ON ledgers (LOWER(name), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  debit NUMERIC NOT NULL DEFAULT 0,
  credit NUMERIC NOT NULL DEFAULT 0,
  transaction_id INT NULL,
  reference_id INT NULL,
  reference_type TEXT NOT NULL,
  description TEXT,
  date TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  branch_id UUID NULL,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED')),
  source_event_key TEXT NOT NULL,
  line_no INT NOT NULL,
  client_txn_id UUID NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer', 'supplier', 'expense')),
  party_id INT NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit = 0 AND credit > 0) OR (credit = 0 AND debit > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entries_event_line
  ON ledger_entries (source_event_key, line_no);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_date
  ON ledger_entries (date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_ledger_date
  ON ledger_entries (ledger_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_ref
  ON ledger_entries (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_branch
  ON ledger_entries (branch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_party
  ON ledger_entries (party_type, party_id, date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entries_client_ledger
  ON ledger_entries (client_txn_id, ledger_id)
  WHERE client_txn_id IS NOT NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS client_txn_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_client_txn_id
  ON transactions (client_txn_id)
  WHERE client_txn_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ensure_system_ledger(p_name TEXT, p_type TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO ledgers (name, type, is_system, branch_id)
  VALUES (p_name, p_type, TRUE, NULL)
  ON CONFLICT (LOWER(name), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT ensure_system_ledger('Cash in Hand', 'ASSET');
SELECT ensure_system_ledger('Bank Account', 'ASSET');
SELECT ensure_system_ledger('Accounts Receivable', 'ASSET');
SELECT ensure_system_ledger('Accounts Payable', 'LIABILITY');
SELECT ensure_system_ledger('Output CGST', 'LIABILITY');
SELECT ensure_system_ledger('Output SGST', 'LIABILITY');
SELECT ensure_system_ledger('Output IGST', 'LIABILITY');
SELECT ensure_system_ledger('Sales (Retail)', 'INCOME');
SELECT ensure_system_ledger('Sales (Wholesale)', 'INCOME');
SELECT ensure_system_ledger('Purchase', 'EXPENSE');
SELECT ensure_system_ledger('Rent', 'EXPENSE');
SELECT ensure_system_ledger('Salaries', 'EXPENSE');
SELECT ensure_system_ledger('Misc Expense', 'EXPENSE');
SELECT ensure_system_ledger('Input CGST', 'ASSET');
SELECT ensure_system_ledger('Input SGST', 'ASSET');
SELECT ensure_system_ledger('Input IGST', 'ASSET');
SELECT ensure_system_ledger('Inventory', 'ASSET');
SELECT ensure_system_ledger('Capital', 'LIABILITY');
SELECT ensure_system_ledger('Drawings Account', 'EXPENSE');
DROP FUNCTION IF EXISTS ensure_system_ledger(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_ledger_id(p_name TEXT)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM ledgers
  WHERE LOWER(name) = LOWER(p_name)
    AND branch_id IS NULL
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Ledger "%" not found', p_name;
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_cash_bank_ledger_name(p_payment_mode TEXT)
RETURNS TEXT AS $$
DECLARE
  v_mode TEXT := LOWER(COALESCE(p_payment_mode, 'cash'));
BEGIN
  IF v_mode IN ('bank', 'online', 'upi') THEN
    RETURN 'Bank Account';
  END IF;
  RETURN 'Cash in Hand';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_ledger_lines(
  p_source_event_key TEXT,
  p_reference_id INT,
  p_reference_type TEXT,
  p_transaction_id INT,
  p_branch_id UUID,
  p_date TIMESTAMP,
  p_description TEXT,
  p_lines JSONB,
  p_client_txn_id UUID DEFAULT NULL,
  p_party_type TEXT DEFAULT NULL,
  p_party_id INT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line JSONB;
  v_ledger_name TEXT;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_ledger_id UUID;
  v_idx INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM ledger_entries WHERE source_event_key = p_source_event_key LIMIT 1) THEN
    RETURN;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF ROUND(v_total_debit::numeric, 2) <> ROUND(v_total_credit::numeric, 2) THEN
    RAISE EXCEPTION 'Double-entry validation failed for %, debit % credit %',
      p_source_event_key, v_total_debit, v_total_credit;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_idx := v_idx + 1;
    v_ledger_name := v_line->>'ledger';
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);

    IF v_debit = 0 AND v_credit = 0 THEN
      CONTINUE;
    END IF;

    v_ledger_id := get_ledger_id(v_ledger_name);
    INSERT INTO ledger_entries (
      ledger_id, debit, credit, transaction_id, reference_id, reference_type,
      description, date, branch_id, sync_status, source_event_key, line_no, client_txn_id, party_type, party_id
    ) VALUES (
      v_ledger_id,
      v_debit,
      v_credit,
      p_transaction_id,
      p_reference_id,
      p_reference_type,
      p_description,
      COALESCE(p_date, NOW() AT TIME ZONE 'UTC'),
      p_branch_id,
      'SYNCED',
      p_source_event_key,
      v_idx,
      p_client_txn_id,
      COALESCE(p_party_type, 'expense'),
      p_party_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_transaction_to_ledger(p_transaction_id INT)
RETURNS VOID AS $$
DECLARE
  v_txn RECORD;
  v_amount NUMERIC := 0;
  v_cash_bank_ledger TEXT;
  v_lines JSONB := '[]'::jsonb;
BEGIN
  SELECT id, amount, total_price, payment_mode, party_type, direction, txn_type, branch_id, created_at, client_txn_id
  INTO v_txn
  FROM transactions
  WHERE id = p_transaction_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Receipt/Payment API now posts ledger lines explicitly with client_txn_id idempotency.
  IF LOWER(COALESCE(v_txn.txn_type, '')) IN ('receipt', 'payment') THEN
    RETURN;
  END IF;

  v_amount := COALESCE(v_txn.amount, v_txn.total_price, 0);
  IF v_amount <= 0 THEN
    RETURN;
  END IF;

  v_cash_bank_ledger := get_cash_bank_ledger_name(v_txn.payment_mode);

  IF v_txn.party_type = 'customer' AND LOWER(COALESCE(v_txn.direction, 'in')) = 'in' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('ledger', v_cash_bank_ledger, 'debit', v_amount, 'credit', 0),
      jsonb_build_object('ledger', 'Accounts Receivable', 'debit', 0, 'credit', v_amount)
    );
  ELSIF v_txn.party_type = 'supplier' AND LOWER(COALESCE(v_txn.direction, 'out')) = 'out' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('ledger', 'Accounts Payable', 'debit', v_amount, 'credit', 0),
      jsonb_build_object('ledger', v_cash_bank_ledger, 'debit', 0, 'credit', v_amount)
    );
  ELSE
    RETURN;
  END IF;

  PERFORM post_ledger_lines(
    CONCAT('transaction:', v_txn.id),
    v_txn.id,
    'payment',
    v_txn.id,
    v_txn.branch_id,
    v_txn.created_at,
    CONCAT('Auto ledger posting for transaction #', v_txn.id),
    v_lines,
    v_txn.client_txn_id
  );
END;
$$ LANGUAGE plpgsql;

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
