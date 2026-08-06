-- Preparation migration for future server-side sync idempotency.
-- Not wired to routes yet. Client operations queue locally first.

CREATE TABLE IF NOT EXISTS sync_operations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT NOT NULL,
  module          VARCHAR(50) NOT NULL,
  entity_type     VARCHAR(50) NOT NULL,
  entity_id       TEXT,
  action          VARCHAR(20) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  retry_count     INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ,
  CONSTRAINT uq_sync_operations_client UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_operations_status_updated
  ON sync_operations (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_operations_module_entity
  ON sync_operations (module, entity_type, entity_id);
