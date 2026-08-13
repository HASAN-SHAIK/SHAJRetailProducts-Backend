-- Track whether an immutable POS inventory movement has been applied to the
-- canonical Central product stock. The movement row itself is the idempotency
-- boundary; sale.completed may project it before inventory.movement.recorded.
ALTER TABLE IF EXISTS pos_inventory_movements
  ADD COLUMN IF NOT EXISTS canonical_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pos_inventory_movements_unapplied
  ON pos_inventory_movements(movement_id)
  WHERE canonical_applied_at IS NULL;
