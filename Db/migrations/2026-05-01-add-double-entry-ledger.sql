CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE')),
  parent_id UUID NULL REFERENCES ledgers(id),
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  branch_id UUID NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledgers_name_branch
  ON ledgers (LOWER(name), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  debit NUMERIC NOT NULL DEFAULT 0,
  credit NUMERIC NOT NULL DEFAULT 0,
  transaction_id INT NULL,
  reference_id INT NULL,
  reference_type TEXT NOT NULL,
  description TEXT,
  date TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  branch_id UUID NULL,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED')),
  source_event_key TEXT NOT NULL,
  line_no INT NOT NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit = 0 AND credit > 0) OR (credit = 0 AND debit > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entries_event_line
  ON ledger_entries (source_event_key, line_no);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_date
  ON ledger_entries (date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_ledger_date
  ON ledger_entries (ledger_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_ref
  ON ledger_entries (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_branch
  ON ledger_entries (branch_id, date DESC);

CREATE OR REPLACE FUNCTION ensure_system_ledger(p_name TEXT, p_type TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO ledgers (name, type, is_system, branch_id)
  VALUES (p_name, p_type, TRUE, NULL)
  ON CONFLICT (LOWER(name), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT ensure_system_ledger('Cash in Hand', 'ASSET');
SELECT ensure_system_ledger('Bank Account', 'ASSET');
SELECT ensure_system_ledger('Accounts Receivable', 'ASSET');
SELECT ensure_system_ledger('Accounts Payable', 'LIABILITY');
SELECT ensure_system_ledger('Output CGST', 'LIABILITY');
SELECT ensure_system_ledger('Output SGST', 'LIABILITY');
SELECT ensure_system_ledger('Output IGST', 'LIABILITY');
SELECT ensure_system_ledger('Sales (Retail)', 'INCOME');
SELECT ensure_system_ledger('Sales (Wholesale)', 'INCOME');
SELECT ensure_system_ledger('Purchase', 'EXPENSE');
SELECT ensure_system_ledger('Rent', 'EXPENSE');
SELECT ensure_system_ledger('Salaries', 'EXPENSE');
SELECT ensure_system_ledger('Misc Expense', 'EXPENSE');
SELECT ensure_system_ledger('Input CGST', 'ASSET');
SELECT ensure_system_ledger('Input SGST', 'ASSET');
SELECT ensure_system_ledger('Input IGST', 'ASSET');

DROP FUNCTION IF EXISTS ensure_system_ledger(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_ledger_id(p_name TEXT)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id
  INTO v_id
  FROM ledgers
  WHERE LOWER(name) = LOWER(p_name)
    AND branch_id IS NULL
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Ledger "%" not found', p_name;
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_cash_bank_ledger_name(p_payment_mode TEXT)
RETURNS TEXT AS $$
DECLARE
  v_mode TEXT := LOWER(COALESCE(p_payment_mode, 'cash'));
BEGIN
  IF v_mode IN ('bank', 'online', 'upi') THEN
    RETURN 'Bank Account';
  END IF;
  RETURN 'Cash in Hand';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_ledger_lines(
  p_source_event_key TEXT,
  p_reference_id INT,
  p_reference_type TEXT,
  p_transaction_id INT,
  p_branch_id UUID,
  p_date TIMESTAMP,
  p_description TEXT,
  p_lines JSONB
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
      description, date, branch_id, sync_status, source_event_key, line_no
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
      v_idx
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_order_to_ledger(p_order_id INT, p_event_suffix TEXT DEFAULT 'create')
RETURNS VOID AS $$
DECLARE
  v_order RECORD;
  v_lines JSONB := '[]'::jsonb;
  v_taxable NUMERIC := 0;
  v_cgst NUMERIC := 0;
  v_sgst NUMERIC := 0;
  v_igst NUMERIC := 0;
  v_sales_ledger TEXT;
  v_event_key TEXT;
  v_total NUMERIC := 0;
  v_reversed_lines JSONB := '[]'::jsonb;
  v_line JSONB;
BEGIN
  SELECT id, total_price, transaction_type, billing_type, branch_id, created_at, is_deleted
  INTO v_order
  FROM orders
  WHERE id = p_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_order.is_deleted IS TRUE AND p_event_suffix = 'create' THEN
    RETURN;
  END IF;

  v_total := COALESCE(v_order.total_price, 0);
  v_event_key := CONCAT('order:', v_order.id, ':', p_event_suffix);

  IF v_order.transaction_type = 'sale' THEN
    SELECT
      COALESCE(SUM(taxable_amount), 0),
      COALESCE(SUM(cgst), 0),
      COALESCE(SUM(sgst), 0),
      COALESCE(SUM(igst), 0)
    INTO v_taxable, v_cgst, v_sgst, v_igst
    FROM gst_ledger
    WHERE bill_id = v_order.id;

    IF v_taxable <= 0 THEN
      v_taxable := GREATEST(v_total - (v_cgst + v_sgst + v_igst), 0);
    END IF;

    v_sales_ledger := CASE
      WHEN LOWER(COALESCE(v_order.billing_type, 'retail')) = 'wholesale' THEN 'Sales (Wholesale)'
      ELSE 'Sales (Retail)'
    END;

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('ledger', 'Accounts Receivable', 'debit', v_total, 'credit', 0),
      jsonb_build_object('ledger', v_sales_ledger, 'debit', 0, 'credit', v_taxable)
    );

    IF v_cgst > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger', 'Output CGST', 'debit', 0, 'credit', v_cgst));
    END IF;
    IF v_sgst > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger', 'Output SGST', 'debit', 0, 'credit', v_sgst));
    END IF;
    IF v_igst > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger', 'Output IGST', 'debit', 0, 'credit', v_igst));
    END IF;
  ELSIF v_order.transaction_type = 'purchase' THEN
    SELECT
      COALESCE(SUM(taxable_amount), 0),
      COALESCE(SUM(cgst), 0),
      COALESCE(SUM(sgst), 0),
      COALESCE(SUM(igst), 0)
    INTO v_taxable, v_cgst, v_sgst, v_igst
    FROM gst_ledger
    WHERE bill_id = v_order.id;

    IF v_taxable <= 0 THEN
      v_taxable := GREATEST(v_total - (v_cgst + v_sgst + v_igst), 0);
    END IF;

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('ledger', 'Purchase', 'debit', v_taxable, 'credit', 0)
    );
    IF v_cgst > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger', 'Input CGST', 'debit', v_cgst, 'credit', 0));
    END IF;
    IF v_sgst > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger', 'Input SGST', 'debit', v_sgst, 'credit', 0));
    END IF;
    IF v_igst > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('ledger', 'Input IGST', 'debit', v_igst, 'credit', 0));
    END IF;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('ledger', 'Accounts Payable', 'debit', 0, 'credit', v_total)
    );
  ELSE
    RETURN;
  END IF;

  IF p_event_suffix <> 'create' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
    LOOP
      v_reversed_lines := v_reversed_lines || jsonb_build_array(
        jsonb_build_object(
          'ledger', v_line->>'ledger',
          'debit', COALESCE((v_line->>'credit')::numeric, 0),
          'credit', COALESCE((v_line->>'debit')::numeric, 0)
        )
      );
    END LOOP;
    v_lines := v_reversed_lines;
  END IF;

  PERFORM post_ledger_lines(
    v_event_key,
    v_order.id,
    'order',
    NULL,
    v_order.branch_id,
    v_order.created_at,
    CONCAT('Auto ledger posting for ', v_order.transaction_type, ' order #', v_order.id),
    v_lines
  );
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE FUNCTION post_customer_payment_to_ledger(p_payment_id INT)
RETURNS VOID AS $$
DECLARE
  v_row RECORD;
  v_cash_bank_ledger TEXT;
BEGIN
  SELECT id, amount, payment_mode, created_at
  INTO v_row
  FROM customer_payments
  WHERE id = p_payment_id
  LIMIT 1;
  IF NOT FOUND OR COALESCE(v_row.amount, 0) <= 0 THEN
    RETURN;
  END IF;
  v_cash_bank_ledger := get_cash_bank_ledger_name(v_row.payment_mode);

  PERFORM post_ledger_lines(
    CONCAT('customer_payment:', v_row.id),
    v_row.id,
    'payment',
    NULL,
    NULL,
    v_row.created_at,
    CONCAT('Customer payment #', v_row.id),
    jsonb_build_array(
      jsonb_build_object('ledger', v_cash_bank_ledger, 'debit', v_row.amount, 'credit', 0),
      jsonb_build_object('ledger', 'Accounts Receivable', 'debit', 0, 'credit', v_row.amount)
    )
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_supplier_payment_to_ledger(p_payment_id INT)
RETURNS VOID AS $$
DECLARE
  v_row RECORD;
  v_branch_id UUID;
  v_cash_bank_ledger TEXT;
BEGIN
  SELECT sp.id, sp.amount, sp.payment_mode, sp.created_at, s.branch_id
  INTO v_row
  FROM supplier_payments sp
  LEFT JOIN suppliers s ON s.id = sp.supplier_id
  WHERE sp.id = p_payment_id
  LIMIT 1;
  IF NOT FOUND OR COALESCE(v_row.amount, 0) <= 0 THEN
    RETURN;
  END IF;
  v_branch_id := v_row.branch_id;
  v_cash_bank_ledger := get_cash_bank_ledger_name(v_row.payment_mode);

  PERFORM post_ledger_lines(
    CONCAT('supplier_payment:', v_row.id),
    v_row.id,
    'payment',
    NULL,
    v_branch_id,
    v_row.created_at,
    CONCAT('Supplier payment #', v_row.id),
    jsonb_build_array(
      jsonb_build_object('ledger', 'Accounts Payable', 'debit', v_row.amount, 'credit', 0),
      jsonb_build_object('ledger', v_cash_bank_ledger, 'debit', 0, 'credit', v_row.amount)
    )
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_expense_to_ledger(p_expense_id UUID)
RETURNS VOID AS $$
DECLARE
  v_row RECORD;
  v_expense_ledger TEXT;
  v_cash_bank_ledger TEXT;
BEGIN
  SELECT id, amount, category, payment_method, created_at, branch_id
  INTO v_row
  FROM expenses
  WHERE id = p_expense_id
  LIMIT 1;
  IF NOT FOUND OR COALESCE(v_row.amount, 0) <= 0 THEN
    RETURN;
  END IF;

  v_expense_ledger := CASE
    WHEN LOWER(COALESCE(v_row.category, '')) LIKE '%rent%' THEN 'Rent'
    WHEN LOWER(COALESCE(v_row.category, '')) LIKE '%sal%' THEN 'Salaries'
    ELSE 'Misc Expense'
  END;
  v_cash_bank_ledger := get_cash_bank_ledger_name(v_row.payment_method);

  PERFORM post_ledger_lines(
    CONCAT('expense:', v_row.id),
    NULL,
    'expense',
    NULL,
    v_row.branch_id,
    v_row.created_at,
    CONCAT('Expense #', v_row.id),
    jsonb_build_array(
      jsonb_build_object('ledger', v_expense_ledger, 'debit', v_row.amount, 'credit', 0),
      jsonb_build_object('ledger', v_cash_bank_ledger, 'debit', 0, 'credit', v_row.amount)
    )
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_sales_return_to_ledger(p_return_id INT)
RETURNS VOID AS $$
DECLARE
  v_row RECORD;
  v_total NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_taxable NUMERIC := 0;
  v_lines JSONB := '[]'::jsonb;
BEGIN
  SELECT r.id, r.order_id, r.refund_total, r.created_at, o.branch_id
  INTO v_row
  FROM order_returns r
  JOIN orders o ON o.id = r.order_id
  WHERE r.id = p_return_id
  LIMIT 1;
  IF NOT FOUND OR COALESCE(v_row.refund_total, 0) <= 0 THEN
    RETURN;
  END IF;
  v_total := v_row.refund_total;

  SELECT COALESCE(SUM(total_tax), 0) INTO v_tax FROM gst_ledger WHERE bill_id = v_row.order_id;
  v_taxable := GREATEST(v_total - v_tax, 0);

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('ledger', 'Sales (Retail)', 'debit', v_taxable, 'credit', 0),
    jsonb_build_object('ledger', 'Accounts Receivable', 'debit', 0, 'credit', v_total)
  );

  PERFORM post_ledger_lines(
    CONCAT('sales_return:', v_row.id),
    v_row.id,
    'return',
    NULL,
    v_row.branch_id,
    v_row.created_at,
    CONCAT('Sales return #', v_row.id),
    v_lines
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_purchase_return_to_ledger(p_return_id INT)
RETURNS VOID AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT pr.id, pr.total_amount, pr.created_at, o.branch_id
  INTO v_row
  FROM purchase_returns pr
  LEFT JOIN orders o ON o.id = pr.purchase_id
  WHERE pr.id = p_return_id
  LIMIT 1;
  IF NOT FOUND OR COALESCE(v_row.total_amount, 0) <= 0 THEN
    RETURN;
  END IF;

  PERFORM post_ledger_lines(
    CONCAT('purchase_return:', v_row.id),
    v_row.id,
    'return',
    NULL,
    v_row.branch_id,
    v_row.created_at,
    CONCAT('Purchase return #', v_row.id),
    jsonb_build_array(
      jsonb_build_object('ledger', 'Accounts Payable', 'debit', v_row.total_amount, 'credit', 0),
      jsonb_build_object('ledger', 'Purchase', 'debit', 0, 'credit', v_row.total_amount)
    )
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_orders_post_ledger() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM post_order_to_ledger(NEW.id, 'create');
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.is_deleted, FALSE) = FALSE AND COALESCE(NEW.is_deleted, FALSE) = TRUE THEN
    PERFORM post_order_to_ledger(NEW.id, 'delete_reverse');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_post_ledger ON orders;
CREATE TRIGGER trg_orders_post_ledger
AFTER INSERT OR UPDATE OF is_deleted ON orders
FOR EACH ROW EXECUTE FUNCTION trg_orders_post_ledger();

CREATE OR REPLACE FUNCTION trg_transactions_post_ledger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM post_transaction_to_ledger(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_post_ledger ON transactions;
CREATE TRIGGER trg_transactions_post_ledger
AFTER INSERT ON transactions
FOR EACH ROW EXECUTE FUNCTION trg_transactions_post_ledger();

CREATE OR REPLACE FUNCTION trg_customer_payments_post_ledger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM post_customer_payment_to_ledger(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_payments_post_ledger ON customer_payments;
CREATE TRIGGER trg_customer_payments_post_ledger
AFTER INSERT ON customer_payments
FOR EACH ROW EXECUTE FUNCTION trg_customer_payments_post_ledger();

CREATE OR REPLACE FUNCTION trg_supplier_payments_post_ledger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM post_supplier_payment_to_ledger(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_payments_post_ledger ON supplier_payments;
CREATE TRIGGER trg_supplier_payments_post_ledger
AFTER INSERT ON supplier_payments
FOR EACH ROW EXECUTE FUNCTION trg_supplier_payments_post_ledger();

CREATE OR REPLACE FUNCTION trg_expenses_post_ledger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM post_expense_to_ledger(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_post_ledger ON expenses;
CREATE TRIGGER trg_expenses_post_ledger
AFTER INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION trg_expenses_post_ledger();

CREATE OR REPLACE FUNCTION trg_order_returns_post_ledger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM post_sales_return_to_ledger(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_returns_post_ledger ON order_returns;
CREATE TRIGGER trg_order_returns_post_ledger
AFTER INSERT ON order_returns
FOR EACH ROW EXECUTE FUNCTION trg_order_returns_post_ledger();

CREATE OR REPLACE FUNCTION trg_purchase_returns_post_ledger() RETURNS TRIGGER AS $$
BEGIN
  PERFORM post_purchase_return_to_ledger(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_returns_post_ledger ON purchase_returns;
CREATE TRIGGER trg_purchase_returns_post_ledger
AFTER INSERT ON purchase_returns
FOR EACH ROW EXECUTE FUNCTION trg_purchase_returns_post_ledger();
