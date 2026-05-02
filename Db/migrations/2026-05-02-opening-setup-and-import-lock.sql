ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS is_opening_completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS opening_completed_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS opening_setup (
  id SERIAL PRIMARY KEY,
  cash_amount NUMERIC NOT NULL DEFAULT 0,
  bank_amount NUMERIC NOT NULL DEFAULT 0,
  inventory_value NUMERIC NOT NULL DEFAULT 0,
  total_capital NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE OR REPLACE FUNCTION ensure_system_ledger_opening(p_name TEXT, p_type TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO ledgers (name, type, is_system, branch_id)
  VALUES (p_name, p_type, TRUE, NULL)
  ON CONFLICT (LOWER(name), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT ensure_system_ledger_opening('Inventory', 'ASSET');
SELECT ensure_system_ledger_opening('Capital', 'LIABILITY');
SELECT ensure_system_ledger_opening('Drawings Account', 'EXPENSE');

DROP FUNCTION IF EXISTS ensure_system_ledger_opening(TEXT, TEXT);
