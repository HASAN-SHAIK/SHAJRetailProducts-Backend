ALTER TABLE order_returns
  ADD COLUMN IF NOT EXISTS return_uuid UUID UNIQUE;
ALTER TABLE order_returns
  ADD COLUMN IF NOT EXISTS tax_reversed NUMERIC;
ALTER TABLE order_returns
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');

ALTER TABLE order_return_items
  ADD COLUMN IF NOT EXISTS batch_id UUID;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE TABLE IF NOT EXISTS bill_corrections (
  id UUID PRIMARY KEY,
  bill_id INT REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT,
  changes JSONB,
  adjusted_amount NUMERIC,
  tax_adjustment NUMERIC,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  is_synced BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_bill_corrections_bill
  ON bill_corrections (bill_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gst_ledger (
  id UUID PRIMARY KEY,
  bill_id INT REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT,
  taxable_amount NUMERIC,
  cgst NUMERIC,
  sgst NUMERIC,
  igst NUMERIC,
  total_tax NUMERIC,
  date DATE,
  is_synced BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_gst_ledger_bill
  ON gst_ledger (bill_id, date DESC);

CREATE TABLE IF NOT EXISTS eway_bills (
  id UUID PRIMARY KEY,
  bill_id INT REFERENCES orders(id) ON DELETE CASCADE,
  transport_details TEXT,
  distance NUMERIC,
  gstin TEXT,
  generated_number TEXT,
  status TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  is_synced BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_eway_bill
  ON eway_bills (bill_id, created_at DESC);
