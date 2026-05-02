CREATE OR REPLACE FUNCTION post_transaction_to_ledger(p_transaction_id INT)
RETURNS VOID AS $$
DECLARE
  v_txn RECORD;
  v_amount NUMERIC := 0;
  v_cash_bank_ledger TEXT;
  v_lines JSONB := '[]'::jsonb;
BEGIN
  SELECT id, amount, total_price, payment_mode, party_type, direction, txn_type, branch_id, created_at
  INTO v_txn
  FROM transactions
  WHERE id = p_transaction_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Receipt/Payment API now posts ledger lines explicitly with client_txn_id idempotency.
  IF LOWER(COALESCE(v_txn.txn_type, '')) IN ('receipt', 'payment') THEN
    RETURN;
  END IF;

  v_amount := COALESCE(v_txn.amount, v_txn.total_price, 0);
  IF v_amount <= 0 THEN
    RETURN;
  END IF;

  v_cash_bank_ledger := get_cash_bank_ledger_name(v_txn.payment_mode);

  IF v_txn.party_type = 'customer' AND LOWER(COALESCE(v_txn.direction, 'in')) = 'in' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('ledger', v_cash_bank_ledger, 'debit', v_amount, 'credit', 0),
      jsonb_build_object('ledger', 'Accounts Receivable', 'debit', 0, 'credit', v_amount)
    );
  ELSIF v_txn.party_type = 'supplier' AND LOWER(COALESCE(v_txn.direction, 'out')) = 'out' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('ledger', 'Accounts Payable', 'debit', v_amount, 'credit', 0),
      jsonb_build_object('ledger', v_cash_bank_ledger, 'debit', 0, 'credit', v_amount)
    );
  ELSE
    RETURN;
  END IF;

  PERFORM post_ledger_lines(
    CONCAT('transaction:', v_txn.id),
    v_txn.id,
    'payment',
    v_txn.id,
    v_txn.branch_id,
    v_txn.created_at,
    CONCAT('Auto ledger posting for transaction #', v_txn.id),
    v_lines
  );
END;
$$ LANGUAGE plpgsql;
