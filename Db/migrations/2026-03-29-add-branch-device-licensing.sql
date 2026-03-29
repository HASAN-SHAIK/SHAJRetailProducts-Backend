CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS max_devices_allowed INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS branch_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  user_id INT,
  device_id TEXT NOT NULL,
  device_name TEXT,
  browser_info TEXT,
  os_info TEXT,
  ip_address TEXT,
  last_login_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_devices_branch_device
  ON branch_devices (branch_id, device_id);

CREATE TABLE IF NOT EXISTS branch_device_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  user_id INT,
  device_id TEXT,
  action TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
