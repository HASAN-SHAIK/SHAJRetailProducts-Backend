BEGIN;

-- STEP 1: add party linkage columns on ledger entries
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS party_type TEXT,
  ADD COLUMN IF NOT EXISTS party_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_ledger_entries_party_type'
  ) THEN
    ALTER TABLE ledger_entries
      ADD CONSTRAINT ck_ledger_entries_party_type
      CHECK (party_type IN ('customer', 'supplier', 'expense'));
  END IF;
END $$;

-- Backfill party linkage from transactions first
UPDATE ledger_entries le
SET party_type = t.party_type,
    party_id = t.party_id
FROM transactions t
WHERE le.transaction_id = t.id
  AND (le.party_type IS NULL OR le.party_id IS NULL);

-- Backfill order-linked customer entries
UPDATE ledger_entries le
SET party_type = 'customer',
    party_id = o.customer_id
FROM orders o
WHERE le.reference_type = 'order'
  AND le.reference_id = o.id
  AND o.customer_id IS NOT NULL
  AND (le.party_type IS NULL OR le.party_id IS NULL);

-- Backfill order-linked supplier entries
UPDATE ledger_entries le
SET party_type = 'supplier',
    party_id = o.supplier_id
FROM orders o
WHERE le.reference_type = 'order'
  AND le.reference_id = o.id
  AND o.supplier_id IS NOT NULL
  AND (le.party_type IS NULL OR le.party_id IS NULL);

-- Keep party type mandatory for all new inserts after this migration.
ALTER TABLE ledger_entries
  ALTER COLUMN party_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_party
  ON ledger_entries (party_type, party_id, date DESC);

-- STEP 2: disable DB auto posting triggers (app-level posting only)
DROP TRIGGER IF EXISTS trg_orders_post_ledger ON orders;
DROP TRIGGER IF EXISTS trg_transactions_post_ledger ON transactions;
DROP TRIGGER IF EXISTS trg_customer_payments_post_ledger ON customer_payments;
DROP TRIGGER IF EXISTS trg_supplier_payments_post_ledger ON supplier_payments;
DROP TRIGGER IF EXISTS trg_expenses_post_ledger ON expenses;
DROP TRIGGER IF EXISTS trg_order_returns_post_ledger ON order_returns;
DROP TRIGGER IF EXISTS trg_purchase_returns_post_ledger ON purchase_returns;

COMMIT;
