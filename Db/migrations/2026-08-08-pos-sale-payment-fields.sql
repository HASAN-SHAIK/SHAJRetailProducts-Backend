ALTER TABLE IF EXISTS pos_sale_payments
  ADD COLUMN IF NOT EXISTS provider_payload_json JSONB,
  ADD COLUMN IF NOT EXISTS recorded_by TEXT;
