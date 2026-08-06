CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pos_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  device_id TEXT,
  store_id TEXT,
  terminal_id TEXT,
  provisioned_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  ordering_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  published_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_dispatch
  ON outbox_events(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate_order
  ON outbox_events(ordering_key, created_at);

CREATE TABLE IF NOT EXISTS inbox_messages (
  message_id TEXT PRIMARY KEY,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed')),
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  stream_name TEXT PRIMARY KEY,
  cursor_value TEXT,
  updated_at TEXT NOT NULL
);
