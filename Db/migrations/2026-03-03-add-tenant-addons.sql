-- Master DB: add addons JSONB + enforce plan_type
ALTER TABLE tenants
  ALTER COLUMN plan_type SET DEFAULT 'basic';

UPDATE tenants
SET plan_type = 'basic'
WHERE plan_type IS NULL;

ALTER TABLE tenants
  ALTER COLUMN plan_type SET NOT NULL;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS addons JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tenants_addons_gin
ON tenants USING GIN (addons);
