-- Cached order fields to avoid joins in order listing
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS total_paid DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_summary TEXT,
  ADD COLUMN IF NOT EXISTS product_count INT DEFAULT 0;

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

-- Backfill cached fields for existing orders
WITH summary AS (
  SELECT oi.order_id,
         STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name) AS product_summary,
         COUNT(*)::int AS product_count
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  GROUP BY oi.order_id
),
payments AS (
  SELECT order_id, COALESCE(SUM(total_price), 0)::numeric AS total_paid
  FROM transactions
  GROUP BY order_id
)
UPDATE orders o
SET product_summary = COALESCE(s.product_summary, ''),
    product_count = COALESCE(s.product_count, 0),
    total_paid = COALESCE(p.total_paid, 0)
FROM summary s
FULL JOIN payments p ON p.order_id = s.order_id
WHERE o.id = COALESCE(s.order_id, p.order_id);
