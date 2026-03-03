-- Enable trigram extension for fast LIKE/ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes with is_deleted predicate to match ILIKE search filters
CREATE INDEX IF NOT EXISTS idx_products_name_trgm_not_deleted
ON products
USING gin (name gin_trgm_ops)
WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_company_trgm_not_deleted
ON products
USING gin (company gin_trgm_ops)
WHERE is_deleted = FALSE;

-- Optional: partial index for other queries that only filter is_deleted
CREATE INDEX IF NOT EXISTS idx_products_not_deleted
ON products (id)
WHERE is_deleted = FALSE;
