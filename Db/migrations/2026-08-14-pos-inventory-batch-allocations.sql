CREATE TABLE IF NOT EXISTS pos_inventory_batch_allocations (
  movement_id TEXT NOT NULL,
  allocation_seq INT NOT NULL,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  product_id INT NOT NULL REFERENCES products(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  batch_id UUID REFERENCES batches(id),
  quantity_milli BIGINT NOT NULL CHECK (quantity_milli > 0),
  allocation_kind TEXT NOT NULL CHECK (allocation_kind IN ('batch', 'unallocated')),
  source_movement_type TEXT NOT NULL CHECK (source_movement_type IN ('sale_issue', 'sale_return')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (movement_id, allocation_seq),
  CONSTRAINT pos_inventory_batch_allocations_kind_batch_ck CHECK (
    (allocation_kind = 'batch' AND batch_id IS NOT NULL) OR
    (allocation_kind = 'unallocated' AND batch_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_batch_allocations_order_item
  ON pos_inventory_batch_allocations(order_id, order_item_id, product_id, branch_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_batch_allocations_batch
  ON pos_inventory_batch_allocations(batch_id)
  WHERE batch_id IS NOT NULL;
