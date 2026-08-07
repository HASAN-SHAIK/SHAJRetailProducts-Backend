-- Inventory movements may reach central before the final sale projection.
-- Keep order_id as a correlation key for sale movements, but remove the
-- dependency on pos_sales so the inventory ledger can synchronize first.
ALTER TABLE IF EXISTS pos_inventory_movements
  DROP CONSTRAINT IF EXISTS pos_inventory_movements_order_id_fkey;

CREATE INDEX IF NOT EXISTS idx_pos_inventory_movements_store_product
  ON pos_inventory_movements(store_id, product_id, occurred_at DESC);
