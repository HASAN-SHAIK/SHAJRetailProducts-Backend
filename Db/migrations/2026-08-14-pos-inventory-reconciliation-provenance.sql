ALTER TABLE IF EXISTS pos_inventory_movements
  ADD COLUMN IF NOT EXISTS canonical_device_id TEXT,
  ADD COLUMN IF NOT EXISTS canonical_branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_movements_canonical_branch
  ON pos_inventory_movements(canonical_branch_id, occurred_at DESC);
