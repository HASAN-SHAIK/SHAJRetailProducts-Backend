ALTER TABLE products
  ADD COLUMN IF NOT EXISTS mrp NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gst_percentage NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS is_batch_enabled BOOLEAN DEFAULT FALSE;

-- Non-negative checks (NULL allowed for legacy rows)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_mrp_non_negative') THEN
    ALTER TABLE products ADD CONSTRAINT products_mrp_non_negative CHECK (mrp IS NULL OR mrp >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_purchase_price_non_negative') THEN
    ALTER TABLE products ADD CONSTRAINT products_purchase_price_non_negative CHECK (purchase_price IS NULL OR purchase_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_gst_non_negative') THEN
    ALTER TABLE products ADD CONSTRAINT products_gst_non_negative CHECK (gst_percentage IS NULL OR gst_percentage >= 0);
  END IF;
END $$;
