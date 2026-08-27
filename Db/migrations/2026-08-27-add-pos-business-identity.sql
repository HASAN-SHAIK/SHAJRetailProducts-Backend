ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS store_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_store_number
  ON branches (UPPER(store_number))
  WHERE store_number IS NOT NULL AND BTRIM(store_number) <> '';

ALTER TABLE branch_devices
  ADD COLUMN IF NOT EXISTS store_number TEXT,
  ADD COLUMN IF NOT EXISTS pos_no TEXT,
  ADD COLUMN IF NOT EXISTS touchpoint_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_devices_business_identity_active
  ON branch_devices (UPPER(store_number), UPPER(pos_no), UPPER(touchpoint_id))
  WHERE is_active = TRUE
    AND store_number IS NOT NULL
    AND pos_no IS NOT NULL
    AND touchpoint_id IS NOT NULL;

ALTER TABLE pos_registration_requests
  ADD COLUMN IF NOT EXISTS store_number TEXT,
  ADD COLUMN IF NOT EXISTS pos_no TEXT,
  ADD COLUMN IF NOT EXISTS touchpoint_id TEXT;

UPDATE branch_devices d
SET store_number = b.store_number
FROM branches b
WHERE d.branch_id = b.id
  AND d.store_number IS NULL
  AND b.store_number IS NOT NULL;

UPDATE pos_registration_requests
SET pos_no = COALESCE(NULLIF(pos_no, ''), NULLIF(terminal_id, ''))
WHERE pos_no IS NULL OR BTRIM(pos_no) = '';
