CREATE OR REPLACE FUNCTION post_sales_return_to_ledger(p_return_id INT)
RETURNS VOID AS $$
DECLARE
  v_row RECORD;
  v_total NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_taxable NUMERIC := 0;
  v_order_total NUMERIC := 0;
  v_order_cgst NUMERIC := 0;
  v_order_sgst NUMERIC := 0;
  v_order_igst NUMERIC := 0;
  v_cgst NUMERIC := 0;
  v_sgst NUMERIC := 0;
  v_igst NUMERIC := 0;
  v_sales_ledger TEXT := 'Sales (Retail)';
  v_lines JSONB := '[]'::jsonb;
BEGIN
  SELECT r.id,
         r.order_id,
         r.refund_total,
         r.tax_reversed,
         r.created_at,
         o.branch_id,
         o.total_price,
         o.billing_type
  INTO v_row
  FROM order_returns r
  JOIN orders o ON o.id = r.order_id
  WHERE r.id = p_return_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(v_row.refund_total, 0) <= 0 THEN
    RETURN;
  END IF;

  v_total := COALESCE(v_row.refund_total, 0);
  v_order_total := COALESCE(v_row.total_price, 0);
  v_sales_ledger := CASE
    WHEN LOWER(COALESCE(v_row.billing_type, 'retail')) = 'wholesale' THEN 'Sales (Wholesale)'
    ELSE 'Sales (Retail)'
  END;

  SELECT COALESCE(SUM(cgst), 0),
         COALESCE(SUM(sgst), 0),
         COALESCE(SUM(igst), 0)
  INTO v_order_cgst, v_order_sgst, v_order_igst
  FROM gst_ledger
  WHERE bill_id = v_row.order_id;

  v_tax_total := COALESCE(v_row.tax_reversed, 0);

  IF v_tax_total > 0 THEN
    -- Split provided tax_reversed proportionally to original tax mix.
    IF (v_order_cgst + v_order_sgst + v_order_igst) > 0 THEN
      v_cgst := ROUND(v_tax_total * (v_order_cgst / (v_order_cgst + v_order_sgst + v_order_igst)), 2);
      v_sgst := ROUND(v_tax_total * (v_order_sgst / (v_order_cgst + v_order_sgst + v_order_igst)), 2);
      v_igst := ROUND(v_tax_total - v_cgst - v_sgst, 2);
    ELSE
      v_igst := ROUND(v_tax_total, 2);
    END IF;
  ELSE
    -- Derive tax reversal from refund ratio vs original bill.
    IF v_order_total > 0 AND (v_order_cgst + v_order_sgst + v_order_igst) > 0 THEN
      v_cgst := ROUND(v_order_cgst * (v_total / v_order_total), 2);
      v_sgst := ROUND(v_order_sgst * (v_total / v_order_total), 2);
      v_igst := ROUND(v_order_igst * (v_total / v_order_total), 2);
      v_tax_total := ROUND(v_cgst + v_sgst + v_igst, 2);
    ELSE
      v_tax_total := 0;
    END IF;
  END IF;

  v_tax_total := ROUND(COALESCE(v_cgst, 0) + COALESCE(v_sgst, 0) + COALESCE(v_igst, 0), 2);
  v_taxable := ROUND(GREATEST(v_total - v_tax_total, 0), 2);

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('ledger', v_sales_ledger, 'debit', v_taxable, 'credit', 0)
  );

  IF v_cgst > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('ledger', 'Output CGST', 'debit', v_cgst, 'credit', 0)
    );
  END IF;
  IF v_sgst > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('ledger', 'Output SGST', 'debit', v_sgst, 'credit', 0)
    );
  END IF;
  IF v_igst > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('ledger', 'Output IGST', 'debit', v_igst, 'credit', 0)
    );
  END IF;

  v_lines := v_lines || jsonb_build_array(
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

