-- 2026-11-08-customer-reminders.sql
-- Enables automated SMS and messaging payment reminders for khata debtors (FEAT-COMM-003)

CREATE TABLE IF NOT EXISTS customer_reminders (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  branch_id UUID,
  recipient_phone TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  channel TEXT DEFAULT 'sms',
  message_text TEXT NOT NULL,
  upi_link TEXT,
  status TEXT DEFAULT 'SENT',
  sent_by INT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_customer_reminders_customer
  ON customer_reminders(customer_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_reminders_branch
  ON customer_reminders(branch_id);
