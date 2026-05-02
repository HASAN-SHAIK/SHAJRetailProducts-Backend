BEGIN;

-- Backfill: supplier payment transactions missing ledger entries
-- Creates:
--   Dr Accounts Payable
--   Cr Cash in Hand / Bank Account

WITH target_txns AS (
  SELECT t.id,
         t.party_id AS supplier_id,
         t.branch_id,
         t.created_at,
         COALESCE(t.amount, t.total_price, 0)::numeric AS amount,
         LOWER(COALESCE(t.payment_mode, 'cash')) AS payment_mode,
         t.client_txn_id
  FROM transactions t
  WHERE t.txn_type = 'payment'
    AND t.party_type = 'supplier'
    AND COALESCE(t.amount, t.total_price, 0) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_entries le
      WHERE le.transaction_id = t.id
    )
),
ledger_ids AS (
  SELECT
    (SELECT id FROM ledgers WHERE name = 'Accounts Payable' ORDER BY created_at ASC LIMIT 1) AS ap_ledger_id,
    (SELECT id FROM ledgers WHERE name = 'Cash in Hand' ORDER BY created_at ASC LIMIT 1) AS cash_ledger_id,
    (SELECT id FROM ledgers WHERE name = 'Bank Account' ORDER BY created_at ASC LIMIT 1) AS bank_ledger_id
)
INSERT INTO ledger_entries (
  ledger_id, debit, credit, transaction_id, reference_id, reference_type, description, date, branch_id,
  sync_status, source_event_key, line_no, client_txn_id, party_type, party_id
)
SELECT
  CASE WHEN x.line_no = 1 THEN l.ap_ledger_id
       WHEN tx.payment_mode IN ('bank', 'online', 'upi') THEN l.bank_ledger_id
       ELSE l.cash_ledger_id END AS ledger_id,
  CASE WHEN x.line_no = 1 THEN tx.amount ELSE 0 END AS debit,
  CASE WHEN x.line_no = 2 THEN tx.amount ELSE 0 END AS credit,
  tx.id AS transaction_id,
  tx.id AS reference_id,
  'payment' AS reference_type,
  CONCAT('Backfill supplier payment #', tx.id) AS description,
  tx.created_at,
  tx.branch_id,
  'SYNCED' AS sync_status,
  CONCAT('backfill:supplier:payment:', tx.id) AS source_event_key,
  x.line_no,
  tx.client_txn_id,
  'supplier' AS party_type,
  tx.supplier_id AS party_id
FROM target_txns tx
CROSS JOIN ledger_ids l
CROSS JOIN (VALUES (1), (2)) AS x(line_no)
WHERE l.ap_ledger_id IS NOT NULL
  AND ((tx.payment_mode IN ('bank', 'online', 'upi') AND l.bank_ledger_id IS NOT NULL)
       OR (tx.payment_mode NOT IN ('bank', 'online', 'upi') AND l.cash_ledger_id IS NOT NULL))
ON CONFLICT (source_event_key, line_no) DO NOTHING;

COMMIT;
