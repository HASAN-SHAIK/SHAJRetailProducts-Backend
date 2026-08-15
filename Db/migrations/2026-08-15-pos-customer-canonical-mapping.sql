CREATE TABLE IF NOT EXISTS pos_customer_mappings (
  pos_customer_id TEXT PRIMARY KEY,
  canonical_customer_id BIGINT NOT NULL REFERENCES customers(id),
  source_event_id TEXT NOT NULL,
  source_version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_customer_mappings_canonical_customer
  ON pos_customer_mappings(canonical_customer_id);

CREATE OR REPLACE FUNCTION resolve_pos_order_customer_mapping()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NULL
     AND NEW.source_channel = 'pos'
     AND NEW.source_customer_id IS NOT NULL THEN
    SELECT canonical_customer_id
      INTO NEW.customer_id
      FROM pos_customer_mappings
     WHERE pos_customer_id = NEW.source_customer_id
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolve_pos_order_customer_mapping ON orders;
CREATE TRIGGER trg_resolve_pos_order_customer_mapping
BEFORE INSERT OR UPDATE OF source_customer_id, customer_id ON orders
FOR EACH ROW
EXECUTE FUNCTION resolve_pos_order_customer_mapping();
