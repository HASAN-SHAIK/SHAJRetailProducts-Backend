ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS client_txn_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_client_txn
  ON ledger_entries (client_txn_id, ledger_id)
  WHERE client_txn_id IS NOT NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS client_txn_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_client_txn
  ON transactions (client_txn_id)
  WHERE client_txn_id IS NOT NULL;

-- Remove old 8-arg overload to avoid ambiguity:
-- "function post_ledger_lines(text, integer, unknown, unknown, uuid, timestamp without time zone, text, jsonb) is not unique"
DROP FUNCTION IF EXISTS post_ledger_lines(
  TEXT,
  INT,
  TEXT,
  INT,
  UUID,
  TIMESTAMP,
  TEXT,
  JSONB
);

CREATE OR REPLACE FUNCTION post_ledger_lines(
  p_source_event_key TEXT,
  p_reference_id INT,
  p_reference_type TEXT,
  p_transaction_id INT,
  p_branch_id UUID,
  p_date TIMESTAMP,
  p_description TEXT,
  p_lines JSONB,
  p_client_txn_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line JSONB;
  v_ledger_name TEXT;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_ledger_id UUID;
  v_idx INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM ledger_entries WHERE source_event_key = p_source_event_key LIMIT 1) THEN
    RETURN;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF ROUND(v_total_debit::numeric, 2) <> ROUND(v_total_credit::numeric, 2) THEN
    RAISE EXCEPTION 'Double-entry validation failed for %, debit % credit %',
      p_source_event_key, v_total_debit, v_total_credit;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_idx := v_idx + 1;
    v_ledger_name := v_line->>'ledger';
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);

    IF v_debit = 0 AND v_credit = 0 THEN
      CONTINUE;
    END IF;

    v_ledger_id := get_ledger_id(v_ledger_name);

    INSERT INTO ledger_entries (
      ledger_id, debit, credit, transaction_id, reference_id, reference_type,
      description, date, branch_id, sync_status, source_event_key, line_no, client_txn_id
    ) VALUES (
      v_ledger_id,
      v_debit,
      v_credit,
      p_transaction_id,
      p_reference_id,
      p_reference_type,
      p_description,
      COALESCE(p_date, NOW() AT TIME ZONE 'UTC'),
      p_branch_id,
      'SYNCED',
      p_source_event_key,
      v_idx,
      p_client_txn_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;
