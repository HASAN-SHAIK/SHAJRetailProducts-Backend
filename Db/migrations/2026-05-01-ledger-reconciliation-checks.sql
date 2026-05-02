-- Reconciliation Pack: run read-only checks after migration

-- 1) Trial balance check: must be zero
SELECT
  ROUND(COALESCE(SUM(debit), 0)::numeric, 2) AS total_debit,
  ROUND(COALESCE(SUM(credit), 0)::numeric, 2) AS total_credit,
  ROUND(COALESCE(SUM(debit - credit), 0)::numeric, 2) AS delta
FROM ledger_entries;

-- 2) Orphan party links in ledger entries
SELECT le.id, le.party_type, le.party_id, le.transaction_id, le.reference_type, le.reference_id
FROM ledger_entries le
LEFT JOIN customers c ON le.party_type = 'customer' AND c.id = le.party_id
LEFT JOIN suppliers s ON le.party_type = 'supplier' AND s.id = le.party_id
WHERE (le.party_type = 'customer' AND c.id IS NULL)
   OR (le.party_type = 'supplier' AND s.id IS NULL)
ORDER BY le.date DESC
LIMIT 200;

-- 3) Customer outstanding from ledger only
SELECT
  le.party_id AS customer_id,
  c.name,
  ROUND(SUM(le.debit)::numeric, 2) AS total_debit,
  ROUND(SUM(le.credit)::numeric, 2) AS total_credit,
  ROUND(SUM(le.debit - le.credit)::numeric, 2) AS outstanding
FROM ledger_entries le
JOIN ledgers l ON l.id = le.ledger_id
JOIN customers c ON c.id = le.party_id
WHERE l.name = 'Accounts Receivable'
  AND le.party_type = 'customer'
GROUP BY le.party_id, c.name
HAVING ROUND(SUM(le.debit - le.credit)::numeric, 2) <> 0
ORDER BY outstanding DESC;

-- 4) Supplier outstanding from ledger only
SELECT
  le.party_id AS supplier_id,
  s.name,
  ROUND(SUM(le.debit)::numeric, 2) AS total_debit,
  ROUND(SUM(le.credit)::numeric, 2) AS total_credit,
  ROUND(SUM(le.credit - le.debit)::numeric, 2) AS outstanding
FROM ledger_entries le
JOIN ledgers l ON l.id = le.ledger_id
JOIN suppliers s ON s.id = le.party_id
WHERE l.name = 'Accounts Payable'
  AND le.party_type = 'supplier'
GROUP BY le.party_id, s.name
HAVING ROUND(SUM(le.credit - le.debit)::numeric, 2) <> 0
ORDER BY outstanding DESC;

-- 5) Duplicate idempotency keys (should be none)
SELECT client_txn_id, ledger_id, COUNT(*)
FROM ledger_entries
WHERE client_txn_id IS NOT NULL
GROUP BY client_txn_id, ledger_id
HAVING COUNT(*) > 1;

-- 6) Potential AP mispostings for supplier purchases/payments
SELECT le.id, le.date, l.name AS ledger_name, le.debit, le.credit, t.txn_type, t.direction, t.party_type, t.party_id
FROM ledger_entries le
JOIN ledgers l ON l.id = le.ledger_id
LEFT JOIN transactions t ON t.id = le.transaction_id
WHERE l.name = 'Accounts Payable'
  AND (
    (t.txn_type = 'purchase' AND le.credit <= 0)
    OR (t.txn_type = 'payment' AND le.debit <= 0)
  )
ORDER BY le.date DESC;
