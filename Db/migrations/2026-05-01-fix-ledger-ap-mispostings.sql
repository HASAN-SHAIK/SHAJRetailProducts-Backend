BEGIN;

-- Data fix: correct common AP mispostings for supplier purchase/payment transactions.
-- It creates reversing + corrected lines with unique source_event_key prefixes.

DO $$
DECLARE
  r RECORD;
  v_ap UUID;
  v_cash UUID;
BEGIN
  SELECT id INTO v_ap FROM ledgers WHERE name = 'Accounts Payable' ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_cash FROM ledgers WHERE name = 'Cash in Hand' ORDER BY created_at ASC LIMIT 1;
  IF v_ap IS NULL THEN
    RAISE NOTICE 'Accounts Payable ledger not found; skipping correction.';
    RETURN;
  END IF;

  FOR r IN
    SELECT t.id AS transaction_id,
           t.party_type,
           t.party_id,
           t.branch_id,
           t.created_at,
           t.txn_type,
           COALESCE(t.amount, t.total_price, 0) AS amount
    FROM transactions t
    WHERE t.party_type = 'supplier'
      AND t.txn_type IN ('purchase', 'payment')
  LOOP
    -- purchase must be AP credit; if not, reverse existing AP lines and insert correct AP credit
    IF r.txn_type = 'purchase' THEN
      IF EXISTS (
        SELECT 1
        FROM ledger_entries le
        WHERE le.transaction_id = r.transaction_id
          AND le.ledger_id = v_ap
          AND le.credit <= 0
      ) THEN
        INSERT INTO ledger_entries (
          ledger_id, debit, credit, transaction_id, reference_id, reference_type, description, date, branch_id,
          sync_status, source_event_key, line_no, client_txn_id, party_type, party_id
        )
        SELECT
          le.ledger_id,
          le.credit,
          le.debit,
          le.transaction_id,
          le.reference_id,
          le.reference_type,
          CONCAT('Reversal fix for transaction #', r.transaction_id),
          le.date,
          le.branch_id,
          'SYNCED',
          CONCAT('fix:reverse:txn:', r.transaction_id),
          ROW_NUMBER() OVER (ORDER BY le.id),
          NULL,
          r.party_type,
          r.party_id
        FROM ledger_entries le
        WHERE le.transaction_id = r.transaction_id
          AND le.ledger_id = v_ap
        ON CONFLICT (source_event_key, line_no) DO NOTHING;

        INSERT INTO ledger_entries (
          ledger_id, debit, credit, transaction_id, reference_id, reference_type, description, date, branch_id,
          sync_status, source_event_key, line_no, client_txn_id, party_type, party_id
        ) VALUES (
          v_ap,
          0,
          r.amount,
          r.transaction_id,
          r.transaction_id,
          'order',
          CONCAT('Corrected AP posting for purchase transaction #', r.transaction_id),
          r.created_at,
          r.branch_id,
          'SYNCED',
          CONCAT('fix:correct:purchase:txn:', r.transaction_id),
          1,
          NULL,
          r.party_type,
          r.party_id
        ) ON CONFLICT (source_event_key, line_no) DO NOTHING;
      END IF;
    END IF;

    -- payment must be AP debit; if not, reverse existing AP lines and insert correct AP debit
    IF r.txn_type = 'payment' THEN
      IF EXISTS (
        SELECT 1
        FROM ledger_entries le
        WHERE le.transaction_id = r.transaction_id
          AND le.ledger_id = v_ap
          AND le.debit <= 0
      ) THEN
        INSERT INTO ledger_entries (
          ledger_id, debit, credit, transaction_id, reference_id, reference_type, description, date, branch_id,
          sync_status, source_event_key, line_no, client_txn_id, party_type, party_id
        )
        SELECT
          le.ledger_id,
          le.credit,
          le.debit,
          le.transaction_id,
          le.reference_id,
          le.reference_type,
          CONCAT('Reversal fix for transaction #', r.transaction_id),
          le.date,
          le.branch_id,
          'SYNCED',
          CONCAT('fix:reverse:txn:', r.transaction_id),
          ROW_NUMBER() OVER (ORDER BY le.id),
          NULL,
          r.party_type,
          r.party_id
        FROM ledger_entries le
        WHERE le.transaction_id = r.transaction_id
          AND le.ledger_id = v_ap
        ON CONFLICT (source_event_key, line_no) DO NOTHING;

        INSERT INTO ledger_entries (
          ledger_id, debit, credit, transaction_id, reference_id, reference_type, description, date, branch_id,
          sync_status, source_event_key, line_no, client_txn_id, party_type, party_id
        ) VALUES (
          v_ap,
          r.amount,
          0,
          r.transaction_id,
          r.transaction_id,
          'payment',
          CONCAT('Corrected AP posting for payment transaction #', r.transaction_id),
          r.created_at,
          r.branch_id,
          'SYNCED',
          CONCAT('fix:correct:payment:txn:', r.transaction_id),
          1,
          NULL,
          r.party_type,
          r.party_id
        ) ON CONFLICT (source_event_key, line_no) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;
