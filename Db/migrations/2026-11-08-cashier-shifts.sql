CREATE TABLE IF NOT EXISTS cashier_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID,
  user_id INT,
  cashier_name TEXT,
  terminal_id TEXT,
  shift_start TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC'),
  shift_end TIMESTAMP WITH TIME ZONE,
  opening_cash NUMERIC DEFAULT 0,
  expected_cash NUMERIC DEFAULT 0,
  declared_cash NUMERIC DEFAULT 0,
  variance NUMERIC DEFAULT 0,
  denominations JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'OPEN',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_branch_status
  ON cashier_shifts (branch_id, status, shift_start DESC);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_user
  ON cashier_shifts (user_id, status);
