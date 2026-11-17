-- DB-level guarantee: two ACTIVE customers cannot share a normalised phone.
-- Safe for tenants that already hold duplicates: the index is created only when
-- no duplicate exists; otherwise a NOTICE is raised and nothing is changed.
-- No customer data is ever deleted or merged. Idempotent.
-- Report existing duplicates with: node scripts/report-duplicate-customer-phones.cjs
DO $$
BEGIN
  IF to_regclass('customers') IS NULL THEN
    RAISE NOTICE 'customers table missing; skipping idx_customers_active_phone_digits_unique';
  ELSIF to_regclass('idx_customers_active_phone_digits_unique') IS NOT NULL THEN
    RAISE NOTICE 'idx_customers_active_phone_digits_unique already exists; nothing to do';
  ELSIF EXISTS (
    SELECT 1
    FROM customers
    WHERE is_active = TRUE
      AND regexp_replace(COALESCE(phone, mobile, ''), '\D', '', 'g') <> ''
    GROUP BY regexp_replace(COALESCE(phone, mobile, ''), '\D', '', 'g')
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'duplicate active customer phones exist; skipping idx_customers_active_phone_digits_unique (run scripts/report-duplicate-customer-phones.cjs, resolve, then re-run this migration)';
  ELSE
    CREATE UNIQUE INDEX idx_customers_active_phone_digits_unique
      ON customers ((regexp_replace(COALESCE(phone, mobile, ''), '\D', '', 'g')))
      WHERE is_active = TRUE
        AND regexp_replace(COALESCE(phone, mobile, ''), '\D', '', 'g') <> '';
  END IF;
END
$$;
