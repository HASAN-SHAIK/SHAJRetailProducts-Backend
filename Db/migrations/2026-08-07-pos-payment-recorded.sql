-- Payments can reach central before sale.completed. Keep order_id as the
-- correlation key, but do not require the completed sale projection to exist.
ALTER TABLE IF EXISTS pos_sale_payments
  DROP CONSTRAINT IF EXISTS pos_sale_payments_order_id_fkey;

ALTER TABLE IF EXISTS pos_sale_payments
  ADD COLUMN IF NOT EXISTS provider_payload_json JSONB;

ALTER TABLE IF EXISTS pos_sale_payments
  ADD COLUMN IF NOT EXISTS recorded_by TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_sale_payments_client_id
  ON pos_sale_payments(client_payment_id);
