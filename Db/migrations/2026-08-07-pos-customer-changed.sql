CREATE TABLE IF NOT EXISTS pos_customers (
  customer_id TEXT PRIMARY KEY,
  customer_code TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  credit_limit_minor BIGINT NOT NULL DEFAULT 0,
  outstanding_minor BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL,
  status TEXT NOT NULL,
  local_version BIGINT NOT NULL,
  source_updated_at TIMESTAMPTZ,
  source_event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_customers_name ON pos_customers(name);
CREATE INDEX IF NOT EXISTS idx_pos_customers_phone ON pos_customers(phone);
CREATE INDEX IF NOT EXISTS idx_pos_customers_email ON pos_customers(email);
