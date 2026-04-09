CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT,
  salary NUMERIC,
  join_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  branch_id UUID
);

CREATE INDEX IF NOT EXISTS idx_staff_name
  ON staff (name);
CREATE INDEX IF NOT EXISTS idx_staff_branch
  ON staff (branch_id);

CREATE TABLE IF NOT EXISTS salaries (
  id UUID PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  month TEXT,
  base_salary NUMERIC,
  bonus NUMERIC,
  deductions NUMERIC,
  net_salary NUMERIC,
  paid_amount NUMERIC,
  pending_amount NUMERIC,
  payment_status TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  branch_id UUID
);

CREATE INDEX IF NOT EXISTS idx_salaries_staff_month
  ON salaries (staff_id, month);
CREATE INDEX IF NOT EXISTS idx_salaries_branch
  ON salaries (branch_id);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS staff_id UUID;
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC');

CREATE INDEX IF NOT EXISTS idx_expenses_staff_date
  ON expenses (staff_id, date DESC);
