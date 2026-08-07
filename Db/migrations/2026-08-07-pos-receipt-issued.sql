-- Receipts may reach central independently of sale.completed.
ALTER TABLE IF EXISTS pos_sale_receipts
  DROP CONSTRAINT IF EXISTS pos_sale_receipts_order_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_sale_receipts_number
  ON pos_sale_receipts(receipt_number);
