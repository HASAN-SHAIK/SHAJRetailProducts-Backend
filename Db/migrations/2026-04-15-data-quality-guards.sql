ALTER TABLE IF EXISTS customers
  ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS merged_into_id INT REFERENCES customers(id);

ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS merged_into_id INT REFERENCES products(id);

CREATE TABLE IF NOT EXISTS dedupe_merge_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'product')),
  primary_id INT NOT NULL,
  secondary_id INT NOT NULL,
  merged_by_user_id INT,
  merged_by_role TEXT,
  merge_reason TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  actor_user_id INT,
  actor_role TEXT,
  actor_name TEXT,
  reason TEXT NOT NULL DEFAULT 'correction',
  source_type TEXT NOT NULL DEFAULT 'system',
  reference_id TEXT,
  delta_quantity NUMERIC DEFAULT 0,
  before_quantity NUMERIC,
  after_quantity NUMERIC,
  delta_purchase_price NUMERIC DEFAULT 0,
  before_purchase_price NUMERIC,
  after_purchase_price NUMERIC,
  delta_selling_price NUMERIC DEFAULT 0,
  before_selling_price NUMERIC,
  after_selling_price NUMERIC,
  note TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_product_created
  ON stock_audit_logs (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_audit_reason_created
  ON stock_audit_logs (reason, created_at DESC);

CREATE TABLE IF NOT EXISTS stock_consistency_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  auto_heal_enabled BOOLEAN DEFAULT TRUE,
  source TEXT DEFAULT 'manual',
  triggered_by TEXT,
  mismatch_count INT DEFAULT 0,
  healed_count INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_consistency_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES stock_consistency_runs(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT,
  product_stock_quantity NUMERIC NOT NULL,
  batches_total_quantity NUMERIC NOT NULL,
  delta_quantity NUMERIC NOT NULL,
  healed BOOLEAN DEFAULT FALSE,
  heal_target_quantity NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_consistency_items_run
  ON stock_consistency_run_items (run_id, created_at DESC);

CREATE OR REPLACE FUNCTION log_product_stock_change() RETURNS TRIGGER AS $$
DECLARE
  resolved_reason TEXT;
  resolved_source TEXT;
  resolved_reference TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       COALESCE(OLD.stock_quantity, 0) <> COALESCE(NEW.stock_quantity, 0)
       OR COALESCE(OLD.purchase_price, 0) <> COALESCE(NEW.purchase_price, 0)
       OR COALESCE(OLD.selling_price, 0) <> COALESCE(NEW.selling_price, 0)
     ) THEN
    resolved_reason := COALESCE(NULLIF(current_setting('app.stock_reason', true), ''), 'correction');
    resolved_source := COALESCE(NULLIF(current_setting('app.stock_source', true), ''), 'system');
    resolved_reference := NULLIF(current_setting('app.stock_reference', true), '');

    INSERT INTO stock_audit_logs (
      product_id,
      branch_id,
      actor_user_id,
      actor_role,
      actor_name,
      reason,
      source_type,
      reference_id,
      delta_quantity,
      before_quantity,
      after_quantity,
      delta_purchase_price,
      before_purchase_price,
      after_purchase_price,
      delta_selling_price,
      before_selling_price,
      after_selling_price
    ) VALUES (
      NEW.id,
      NEW.branch_id,
      NULLIF(current_setting('app.actor_user_id', true), '')::INT,
      NULLIF(current_setting('app.actor_role', true), ''),
      NULLIF(current_setting('app.actor_name', true), ''),
      resolved_reason,
      resolved_source,
      resolved_reference,
      COALESCE(NEW.stock_quantity, 0) - COALESCE(OLD.stock_quantity, 0),
      OLD.stock_quantity,
      NEW.stock_quantity,
      COALESCE(NEW.purchase_price, 0) - COALESCE(OLD.purchase_price, 0),
      OLD.purchase_price,
      NEW.purchase_price,
      COALESCE(NEW.selling_price, 0) - COALESCE(OLD.selling_price, 0),
      OLD.selling_price,
      NEW.selling_price
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_stock_audit ON products;
CREATE TRIGGER trg_products_stock_audit
AFTER UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION log_product_stock_change();
