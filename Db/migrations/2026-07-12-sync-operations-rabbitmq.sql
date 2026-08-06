-- RabbitMQ sync operation extensions (idempotent on tenant DBs).

ALTER TABLE sync_operations
  ADD COLUMN IF NOT EXISTS ordering_key TEXT,
  ADD COLUMN IF NOT EXISTS message_id TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sync_operations_client_status
  ON sync_operations (client_id, status);
