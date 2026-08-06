-- Performance optimization indexes (tenant + platform).

CREATE INDEX IF NOT EXISTS idx_order_items_order_product
  ON order_items (order_id, product_id);

CREATE INDEX IF NOT EXISTS idx_gst_ledger_date
  ON gst_ledger (date DESC);

-- Platform DB indexes (run on master/platform database).
-- CREATE INDEX IF NOT EXISTS idx_subscription_payments_status_paid_at
--   ON subscription_payments (status, paid_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_end
--   ON subscriptions (tenant_id, end_date DESC NULLS LAST, id DESC);
