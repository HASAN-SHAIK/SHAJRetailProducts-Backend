ALTER TABLE products
ADD COLUMN IF NOT EXISTS barcode VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode
ON products(barcode)
WHERE barcode IS NOT NULL;
