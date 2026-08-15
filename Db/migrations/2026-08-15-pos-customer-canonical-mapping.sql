CREATE TABLE IF NOT EXISTS pos_customer_mappings (
  pos_customer_id TEXT PRIMARY KEY,
  canonical_customer_id BIGINT NOT NULL REFERENCES customers(id),
  source_event_id TEXT NOT NULL,
  source_version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_customer_mappings_canonical_customer
  ON pos_customer_mappings(canonical_customer_id);
