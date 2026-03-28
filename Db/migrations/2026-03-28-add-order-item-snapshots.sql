-- Add snapshot pricing fields for order_items to support per-order price overrides
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS purchase_price_snapshot NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS selling_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margin_percent NUMERIC(10, 2) DEFAULT 0;

-- Backfill snapshot values for existing rows
UPDATE order_items oi
SET purchase_price_snapshot = COALESCE(oi.purchase_price_snapshot, p.purchase_price),
    gst_percent = COALESCE(oi.gst_percent, p.gst_percentage, 0)
FROM products p
WHERE p.id = oi.product_id
  AND (oi.purchase_price_snapshot IS NULL OR oi.gst_percent IS NULL);

-- Backfill profit and margin for existing rows
UPDATE order_items
SET profit = COALESCE(profit, 0) + (
    COALESCE(selling_price, 0) - COALESCE(purchase_price_snapshot, 0)
  ) * COALESCE(quantity, 0) - COALESCE(discount_amount, 0),
    margin_percent = CASE
      WHEN COALESCE(selling_price, 0) * COALESCE(quantity, 0) > 0
        THEN ROUND(
          (
            (
              (COALESCE(selling_price, 0) - COALESCE(purchase_price_snapshot, 0)) * COALESCE(quantity, 0)
              - COALESCE(discount_amount, 0)
            ) / (COALESCE(selling_price, 0) * COALESCE(quantity, 0))
          ) * 100,
          2
        )
      ELSE 0
    END
WHERE profit IS NULL OR margin_percent IS NULL;
