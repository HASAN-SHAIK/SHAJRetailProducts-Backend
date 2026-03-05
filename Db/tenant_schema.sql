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

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255),
  is_weight_based BOOLEAN DEFAULT FALSE,
  selling_price DECIMAL(10,2) NOT NULL,
  actual_price DECIMAL(10,2),
  stock_quantity DECIMAL(10,2) NOT NULL,
  company VARCHAR(255),
  time_for_delivery INT DEFAULT 0,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT NULL,
  customer_id INT NULL,
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
  payment_mode VARCHAR(10) CHECK (payment_mode IN ('cash', 'online'))

);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT,
  product_id INT,
  quantity DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2),
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
  WHERE order_id = p_order_id;

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
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_profit NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_orders INT NOT NULL DEFAULT 0,
  credit_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (day, location)
);

CREATE TABLE IF NOT EXISTS tenant_order_daily (
  day DATE NOT NULL,
  location TEXT,
  order_id INT NOT NULL,
  PRIMARY KEY (day, location, order_id)
);

CREATE TABLE IF NOT EXISTS tenant_product_daily (
  day DATE NOT NULL,
  location TEXT,
  product_id INT NOT NULL,
  product_name TEXT,
  qty_sold NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (day, location, product_id)
);

CREATE TABLE IF NOT EXISTS tenant_customer_daily (
  day DATE NOT NULL,
  location TEXT,
  customer_id INT NOT NULL,
  customer_name TEXT,
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_orders INT NOT NULL DEFAULT 0,
  credit_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (day, location, customer_id)
);

CREATE TABLE IF NOT EXISTS tenant_customer_order_daily (
  day DATE NOT NULL,
  location TEXT,
  customer_id INT NOT NULL,
  order_id INT NOT NULL,
  PRIMARY KEY (day, location, customer_id, order_id)
);

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
  p_transaction_type TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_day DATE;
  v_location TEXT;
  v_type TEXT;
  v_product_name TEXT;
BEGIN
  SELECT o.created_at, o.location, o.transaction_type
  INTO v_day, v_location, v_type
  FROM orders o
  WHERE o.id = p_order_id;

  IF p_location IS NOT NULL THEN
    v_location := p_location;
  END IF;
  IF p_transaction_type IS NOT NULL THEN
    v_type := p_transaction_type;
  END IF;

  v_day := DATE(v_day);
  v_location := NULLIF(BTRIM(v_location), '');
  IF v_location IS NULL THEN
    v_location := 'Unknown';
  END IF;

  IF v_type IS DISTINCT FROM 'sale' THEN
    RETURN;
  END IF;

  SELECT p.name INTO v_product_name FROM products p WHERE p.id = p_product_id;

  INSERT INTO tenant_product_daily (day, location, product_id, product_name, qty_sold, revenue)
  VALUES (
    v_day,
    v_location,
    p_product_id,
    v_product_name,
    p_sign * COALESCE(p_qty, 0),
    p_sign * COALESCE(p_qty, 0) * COALESCE(p_price, 0)
  )
  ON CONFLICT (day, location, product_id) DO UPDATE
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
  p_transaction_type TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_day DATE;
  v_location TEXT;
  v_type TEXT;
  v_credit NUMERIC := 0;
  v_customer_id INT;
  v_customer_name TEXT;
BEGIN
  v_day := DATE(p_created_at);

  IF p_location IS NULL OR p_transaction_type IS NULL THEN
    SELECT o.location, o.transaction_type, o.customer_id, o.customer_name_snapshot
    INTO v_location, v_type, v_customer_id, v_customer_name
    FROM orders o
    WHERE o.id = p_order_id;
  ELSE
    v_location := p_location;
    v_type := p_transaction_type;
    SELECT o.customer_id, o.customer_name_snapshot
    INTO v_customer_id, v_customer_name
    FROM orders o
    WHERE o.id = p_order_id;
  END IF;

  v_location := NULLIF(BTRIM(v_location), '');
  IF v_location IS NULL THEN
    v_location := 'Unknown';
  END IF;

  IF v_type IS DISTINCT FROM 'sale' THEN
    RETURN;
  END IF;

  IF p_payment_mode = 'credit' THEN
    v_credit := COALESCE(p_total_price, 0);
  END IF;

  INSERT INTO tenant_dashboard_metrics (day, location, total_revenue, total_profit, total_orders, credit_outstanding)
  VALUES (
    v_day,
    v_location,
    p_sign * COALESCE(p_total_price, 0),
    p_sign * COALESCE(p_profit, 0),
    0,
    p_sign * COALESCE(v_credit, 0)
  )
  ON CONFLICT (day, location) DO UPDATE
  SET total_revenue = tenant_dashboard_metrics.total_revenue + EXCLUDED.total_revenue,
      total_profit = tenant_dashboard_metrics.total_profit + EXCLUDED.total_profit,
      credit_outstanding = tenant_dashboard_metrics.credit_outstanding + EXCLUDED.credit_outstanding,
      updated_at = (NOW() AT TIME ZONE 'UTC');

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO tenant_customer_daily (day, location, customer_id, customer_name, total_revenue, total_orders, credit_outstanding)
    VALUES (
      v_day,
      v_location,
      v_customer_id,
      v_customer_name,
      p_sign * COALESCE(p_total_price, 0),
      0,
      p_sign * COALESCE(v_credit, 0)
    )
    ON CONFLICT (day, location, customer_id) DO UPDATE
    SET total_revenue = tenant_customer_daily.total_revenue + EXCLUDED.total_revenue,
        credit_outstanding = tenant_customer_daily.credit_outstanding + EXCLUDED.credit_outstanding,
        customer_name = COALESCE(EXCLUDED.customer_name, tenant_customer_daily.customer_name),
        updated_at = (NOW() AT TIME ZONE 'UTC');
  END IF;

  IF p_sign > 0 THEN
    INSERT INTO tenant_order_daily (day, location, order_id)
    VALUES (v_day, v_location, p_order_id)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE tenant_dashboard_metrics
      SET total_orders = total_orders + 1,
          updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE day = v_day AND location IS NOT DISTINCT FROM v_location;
    END IF;

    IF v_customer_id IS NOT NULL THEN
      INSERT INTO tenant_customer_order_daily (day, location, customer_id, order_id)
      VALUES (v_day, v_location, v_customer_id, p_order_id)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN
        UPDATE tenant_customer_daily
        SET total_orders = total_orders + 1,
            updated_at = (NOW() AT TIME ZONE 'UTC')
        WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND customer_id = v_customer_id;
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
      WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND order_id = p_order_id;
      UPDATE tenant_dashboard_metrics
      SET total_orders = GREATEST(total_orders - 1, 0),
          updated_at = (NOW() AT TIME ZONE 'UTC')
      WHERE day = v_day AND location IS NOT DISTINCT FROM v_location;

      IF v_customer_id IS NOT NULL THEN
        DELETE FROM tenant_customer_order_daily
        WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND customer_id = v_customer_id AND order_id = p_order_id;
        UPDATE tenant_customer_daily
        SET total_orders = GREATEST(total_orders - 1, 0),
            updated_at = (NOW() AT TIME ZONE 'UTC')
        WHERE day = v_day AND location IS NOT DISTINCT FROM v_location AND customer_id = v_customer_id;
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
     OR (OLD.transaction_type IS DISTINCT FROM NEW.transaction_type) THEN
    FOR t IN SELECT * FROM transactions WHERE order_id = NEW.id LOOP
      PERFORM apply_txn_metrics(t.order_id, t.created_at, t.total_price, t.profit, t.payment_mode, -1, OLD.location, OLD.transaction_type);
      PERFORM apply_txn_metrics(t.order_id, t.created_at, t.total_price, t.profit, t.payment_mode, 1, NEW.location, NEW.transaction_type);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_metrics_relocate ON orders;
CREATE TRIGGER orders_metrics_relocate
AFTER UPDATE OF location, transaction_type ON orders
FOR EACH ROW EXECUTE FUNCTION trg_orders_metrics_relocate();

CREATE OR REPLACE FUNCTION trg_orders_relocate_product_metrics() RETURNS TRIGGER AS $$
DECLARE
  i RECORD;
BEGIN
  IF (OLD.location IS DISTINCT FROM NEW.location)
     OR (OLD.transaction_type IS DISTINCT FROM NEW.transaction_type) THEN
    FOR i IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
      PERFORM apply_order_item_metrics(i.order_id, i.product_id, i.quantity, i.selling_price, -1, OLD.location, OLD.transaction_type);
      PERFORM apply_order_item_metrics(i.order_id, i.product_id, i.quantity, i.selling_price, 1, NEW.location, NEW.transaction_type);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_relocate_product_metrics ON orders;
CREATE TRIGGER orders_relocate_product_metrics
AFTER UPDATE OF location, transaction_type ON orders
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
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_low_stock
  ON products (stock_quantity)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_customers_created
  ON customers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);
