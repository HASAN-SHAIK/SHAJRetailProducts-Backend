-- Payments can reach central before sale.completed. Keep order_id as the
-- correlation key, but do not require the completed sale projection to exist.
ALTER TABLE IF EXISTS pos_sale_payments
  DROP CONSTRAINT IF EXISTS pos_sale_payments_order_id_fkey;

CREATE INDEX IF NOT EXISTS idx_pos_sale_payments_client_id
  ON pos_sale_payments(client_payment_id);
