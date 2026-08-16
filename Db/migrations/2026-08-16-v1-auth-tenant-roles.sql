-- V1 Authentication/Authorization: align persisted tenant roles with the
-- authoritative permission catalog. Idempotent for existing tenant databases.
ALTER TABLE IF EXISTS users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE IF EXISTS users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'cashier', 'staff'));
