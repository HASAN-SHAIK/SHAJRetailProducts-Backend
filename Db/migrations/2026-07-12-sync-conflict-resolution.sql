-- Conflict resolution metadata for sync operations.

ALTER TABLE sync_operations
  ADD COLUMN IF NOT EXISTS source_version INT,
  ADD COLUMN IF NOT EXISTS resolution_outcome VARCHAR(40),
  ADD COLUMN IF NOT EXISTS conflict_details JSONB;

CREATE INDEX IF NOT EXISTS idx_sync_operations_resolution
  ON sync_operations (resolution_outcome)
  WHERE resolution_outcome IS NOT NULL;
