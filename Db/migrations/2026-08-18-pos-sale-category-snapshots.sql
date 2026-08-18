-- V1 Reporting/Admin: preserve the category identity/name that the offline POS knew when a sale completed.
-- These are immutable reporting snapshots, not foreign keys. Historical rows without snapshots remain unattributed.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS category_id_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS category_name_snapshot TEXT;

ALTER TABLE pos_sale_items
  ADD COLUMN IF NOT EXISTS category_id_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS category_name_snapshot TEXT;

COMMENT ON COLUMN order_items.category_id_snapshot IS
  'Immutable Central-projected POS category identifier captured at sale time; nullable for pre-V1 history.';
COMMENT ON COLUMN order_items.category_name_snapshot IS
  'Immutable Central-projected POS category name captured at sale time; nullable for pre-V1 history.';
COMMENT ON COLUMN pos_sale_items.category_id_snapshot IS
  'Compatibility copy of the POS sale-time category identifier snapshot.';
COMMENT ON COLUMN pos_sale_items.category_name_snapshot IS
  'Compatibility copy of the POS sale-time category name snapshot.';
