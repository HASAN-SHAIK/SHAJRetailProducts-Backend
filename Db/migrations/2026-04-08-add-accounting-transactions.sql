ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS amount NUMERIC;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS party_type TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS party_id INT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS direction TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS txn_type TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID;

UPDATE transactions
SET amount = total_price
WHERE amount IS NULL;

UPDATE transactions
SET txn_type = 'sale'
WHERE txn_type IS NULL;

UPDATE transactions
SET direction = 'in'
WHERE direction IS NULL;

UPDATE transactions t
SET party_type = CASE WHEN o.transaction_type = 'purchase' THEN 'supplier' ELSE 'customer' END,
    party_id = CASE WHEN o.transaction_type = 'purchase' THEN o.supplier_id ELSE o.customer_id END,
    branch_id = COALESCE(t.branch_id, o.branch_id)
FROM orders o
WHERE t.order_id = o.id
  AND (t.party_type IS NULL OR t.party_id IS NULL OR t.branch_id IS NULL);

UPDATE transactions
SET txn_type = 'refund',
    direction = 'out'
WHERE transaction_type = 'refund';

CREATE INDEX IF NOT EXISTS idx_transactions_party
  ON transactions (party_type, party_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_txn_type
  ON transactions (txn_type);

CREATE INDEX IF NOT EXISTS idx_transactions_branch_created
  ON transactions (branch_id, created_at DESC);
