CREATE TABLE IF NOT EXISTS pos_sync_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INT NOT NULL CHECK (aggregate_version > 0),
  schema_version INT NOT NULL CHECK (schema_version > 0),
  ordering_key TEXT,
  payload_json JSONB NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_created_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_sync_events_aggregate
  ON pos_sync_events (aggregate_type, aggregate_id, aggregate_version);

CREATE INDEX IF NOT EXISTS idx_pos_sync_events_received_at
  ON pos_sync_events (received_at DESC);
