-- Dashboard summary table + trigger logic (tenant DBs)
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

-- Backfill summary data from existing transactions/orders
INSERT INTO tenant_dashboard_metrics (day, location, total_revenue, total_profit, total_orders, credit_outstanding)
SELECT
  DATE(t.created_at) AS day,
  o.location,
  COALESCE(SUM(t.total_price), 0)::numeric AS total_revenue,
  COALESCE(SUM(t.profit), 0)::numeric AS total_profit,
  COUNT(DISTINCT o.id)::int AS total_orders,
  COALESCE(SUM(CASE WHEN t.payment_mode = 'credit' THEN t.total_price END), 0)::numeric AS credit_outstanding
FROM transactions t
JOIN orders o ON o.id = t.order_id
WHERE o.transaction_type = 'sale'
GROUP BY DATE(t.created_at), o.location
ON CONFLICT (day, location) DO UPDATE
SET total_revenue = EXCLUDED.total_revenue,
    total_profit = EXCLUDED.total_profit,
    total_orders = EXCLUDED.total_orders,
    credit_outstanding = EXCLUDED.credit_outstanding,
    updated_at = (NOW() AT TIME ZONE 'UTC');

INSERT INTO tenant_order_daily (day, location, order_id)
SELECT DISTINCT
  DATE(t.created_at) AS day,
  o.location,
  o.id AS order_id
FROM transactions t
JOIN orders o ON o.id = t.order_id
WHERE o.transaction_type = 'sale'
ON CONFLICT DO NOTHING;

-- Helper to apply a transaction delta into summary tables
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
BEGIN
  v_day := DATE(p_created_at);

  IF p_location IS NULL OR p_transaction_type IS NULL THEN
    SELECT o.location, o.transaction_type
    INTO v_location, v_type
    FROM orders o
    WHERE o.id = p_order_id;
  ELSE
    v_location := p_location;
    v_type := p_transaction_type;
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
