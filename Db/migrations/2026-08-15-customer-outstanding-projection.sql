CREATE OR REPLACE FUNCTION recompute_customer_outstanding(p_customer_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE customers c
  SET current_balance = GREATEST(
        COALESCE((
          SELECT SUM(
            GREATEST(
              COALESCE(o.total_price,0)
              - COALESCE(o.total_paid,0)
              - COALESCE(o.returned_amount,0),
              0
            )
          )
          FROM orders o
          WHERE o.customer_id = p_customer_id
            AND COALESCE(o.is_deleted,FALSE)=FALSE
            AND LOWER(COALESCE(o.order_status,'')) NOT IN ('voided','cancelled','canceled')
        ),0)
        - COALESCE((
          SELECT SUM(cp.amount)
          FROM customer_payments cp
          WHERE cp.customer_id = p_customer_id
        ),0),
        0
      ),
      updated_at = NOW()
  WHERE c.id = p_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION project_customer_outstanding_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_customer_outstanding(OLD.customer_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM recompute_customer_outstanding(OLD.customer_id);
  END IF;

  PERFORM recompute_customer_outstanding(NEW.customer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_customer_outstanding ON orders;
CREATE TRIGGER trg_orders_customer_outstanding
AFTER INSERT OR UPDATE OF customer_id,total_price,total_paid,returned_amount,order_status,is_deleted OR DELETE
ON orders
FOR EACH ROW
EXECUTE FUNCTION project_customer_outstanding_from_order();

CREATE OR REPLACE FUNCTION project_customer_outstanding_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_customer_outstanding(OLD.customer_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM recompute_customer_outstanding(OLD.customer_id);
  END IF;

  PERFORM recompute_customer_outstanding(NEW.customer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_payments_outstanding ON customer_payments;
CREATE TRIGGER trg_customer_payments_outstanding
AFTER INSERT OR UPDATE OF customer_id,amount OR DELETE
ON customer_payments
FOR EACH ROW
EXECUTE FUNCTION project_customer_outstanding_from_payment();

DO $$
DECLARE
  customer_row RECORD;
BEGIN
  FOR customer_row IN SELECT id FROM customers LOOP
    PERFORM recompute_customer_outstanding(customer_row.id);
  END LOOP;
END;
$$;
