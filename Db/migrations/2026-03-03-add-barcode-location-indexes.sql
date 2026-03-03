-- Optimize barcode lookups and location filters
DROP INDEX IF EXISTS idx_products_barcode;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_active
ON products (barcode)
WHERE is_deleted = FALSE AND barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_location
ON orders (location)
WHERE location IS NOT NULL;
