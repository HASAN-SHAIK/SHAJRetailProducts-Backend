-- Denormalized analytics helpers to reduce runtime JOINs

-- 1) Orders snapshot columns for customer data
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS customer_mobile_snapshot TEXT;

UPDATE orders o
SET customer_name_snapshot = c.name,
    customer_mobile_snapshot = c.mobile
FROM customers c
WHERE o.customer_id = c.id
  AND (o.customer_name_snapshot IS NULL OR o.customer_mobile_snapshot IS NULL);

-- 2) Daily product metrics (sales)
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

-- 3) Daily customer metrics (sales + credit)
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

-- 4) Snapshot customer info on orders
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

-- 5) Apply product metrics per order item
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

-- 6) Extend transaction metrics to update customer daily metrics
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

-- 7) Relocate product metrics if order location/type changes
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

-- 8) Backfill daily product metrics
INSERT INTO tenant_product_daily (day, location, product_id, product_name, qty_sold, revenue)
SELECT
  DATE(o.created_at) AS day,
  COALESCE(NULLIF(BTRIM(o.location), ''), 'Unknown') AS location,
  p.id AS product_id,
  p.name AS product_name,
  COALESCE(SUM(oi.quantity), 0)::numeric AS qty_sold,
  COALESCE(SUM(oi.quantity * oi.selling_price), 0)::numeric AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE o.transaction_type = 'sale'
GROUP BY DATE(o.created_at), COALESCE(NULLIF(BTRIM(o.location), ''), 'Unknown'), p.id, p.name
ON CONFLICT (day, location, product_id) DO UPDATE
SET qty_sold = EXCLUDED.qty_sold,
    revenue = EXCLUDED.revenue,
    product_name = EXCLUDED.product_name,
    updated_at = (NOW() AT TIME ZONE 'UTC');

-- 9) Backfill customer daily + order daily
INSERT INTO tenant_customer_order_daily (day, location, customer_id, order_id)
SELECT DISTINCT
  DATE(t.created_at) AS day,
  COALESCE(NULLIF(BTRIM(o.location), ''), 'Unknown') AS location,
  o.customer_id,
  o.id AS order_id
FROM transactions t
JOIN orders o ON o.id = t.order_id
WHERE o.transaction_type = 'sale'
  AND o.customer_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO tenant_customer_daily (day, location, customer_id, customer_name, total_revenue, total_orders, credit_outstanding)
SELECT
  DATE(t.created_at) AS day,
  COALESCE(NULLIF(BTRIM(o.location), ''), 'Unknown') AS location,
  o.customer_id,
  COALESCE(o.customer_name_snapshot, c.name) AS customer_name,
  COALESCE(SUM(t.total_price), 0)::numeric AS total_revenue,
  COUNT(DISTINCT o.id)::int AS total_orders,
  COALESCE(SUM(CASE WHEN t.payment_mode = 'credit' THEN t.total_price END), 0)::numeric AS credit_outstanding
FROM transactions t
JOIN orders o ON o.id = t.order_id
LEFT JOIN customers c ON c.id = o.customer_id
WHERE o.transaction_type = 'sale'
  AND o.customer_id IS NOT NULL
GROUP BY DATE(t.created_at), COALESCE(NULLIF(BTRIM(o.location), ''), 'Unknown'), o.customer_id, COALESCE(o.customer_name_snapshot, c.name)
ON CONFLICT (day, location, customer_id) DO UPDATE
SET total_revenue = EXCLUDED.total_revenue,
    total_orders = EXCLUDED.total_orders,
    credit_outstanding = EXCLUDED.credit_outstanding,
    customer_name = EXCLUDED.customer_name,
    updated_at = (NOW() AT TIME ZONE 'UTC');
