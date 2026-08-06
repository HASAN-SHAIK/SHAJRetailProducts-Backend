const {
  SYNC_OPERATION_STATUS,
  SYNC_OPERATION_ACTION,
} = require('../../services/syncOperationPrep.service');

const buildOrderingKey = ({ tenantId, module, entityType, entityId, clientId }) =>
  `${tenantId || 'tenant'}:${module || 'general'}:${entityType || 'entity'}:${entityId || clientId || 'unknown'}`;

const mapRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    module: row.module,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    payload: row.payload_json,
    status: row.status,
    retryCount: row.retry_count,
    lastError: row.last_error,
    orderingKey: row.ordering_key,
    messageId: row.message_id,
    sourceUpdatedAt: row.source_updated_at,
    sourceVersion: row.source_version,
    resolutionOutcome: row.resolution_outcome,
    conflictDetails: row.conflict_details,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  };
};

const ensureSchema = async (pool) => {
  await pool.query(`
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
      ordering_key    TEXT,
      message_id      TEXT,
      source_updated_at TIMESTAMPTZ,
      created_by      INT REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      synced_at       TIMESTAMPTZ,
      CONSTRAINT uq_sync_operations_client UNIQUE (client_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sync_operations_status_updated
      ON sync_operations (status, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sync_operations_module_entity
      ON sync_operations (module, entity_type, entity_id)
  `);
  await pool.query(`
    ALTER TABLE sync_operations
      ADD COLUMN IF NOT EXISTS source_version INT,
      ADD COLUMN IF NOT EXISTS resolution_outcome VARCHAR(40),
      ADD COLUMN IF NOT EXISTS conflict_details JSONB
  `);
};

const findByClientId = async (pool, clientId) => {
  const result = await pool.query(
    `SELECT *
     FROM sync_operations
     WHERE client_id = $1
     LIMIT 1`,
    [clientId]
  );
  return mapRow(result.rows[0]);
};

const findById = async (pool, operationId) => {
  const result = await pool.query(
    `SELECT *
     FROM sync_operations
     WHERE id = $1
     LIMIT 1`,
    [operationId]
  );
  return mapRow(result.rows[0]);
};

const insertOperation = async (pool, operation = {}) => {
  const {
    clientId,
    module,
    entityType,
    entityId,
    action,
    payload = {},
    createdBy = null,
    orderingKey,
    messageId,
    sourceUpdatedAt = null,
    sourceVersion = null,
  } = operation;

  const normalizedAction = String(action || SYNC_OPERATION_ACTION.UPDATE).toUpperCase();
  const result = await pool.query(
    `INSERT INTO sync_operations (
       client_id, module, entity_type, entity_id, action, payload_json,
       status, ordering_key, message_id, source_updated_at, source_version, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (client_id) DO NOTHING
     RETURNING *`,
    [
      clientId,
      module,
      entityType,
      entityId || null,
      normalizedAction,
      JSON.stringify(payload || {}),
      SYNC_OPERATION_STATUS.PENDING,
      orderingKey,
      messageId || clientId,
      sourceUpdatedAt,
      sourceVersion,
      createdBy,
    ]
  );

  if (result.rowCount > 0) {
    return { record: mapRow(result.rows[0]), created: true };
  }

  const existing = await findByClientId(pool, clientId);
  return { record: existing, created: false };
};

const markProcessing = async (pool, operationId) => {
  const result = await pool.query(
    `UPDATE sync_operations
     SET status = $2,
         updated_at = NOW()
     WHERE id = $1
       AND status IN ($3, $4)
     RETURNING *`,
    [
      operationId,
      SYNC_OPERATION_STATUS.PROCESSING,
      SYNC_OPERATION_STATUS.PENDING,
      SYNC_OPERATION_STATUS.FAILED,
    ]
  );
  return mapRow(result.rows[0]);
};

const markSynced = async (pool, operationId, resolution = {}) => {
  const result = await pool.query(
    `UPDATE sync_operations
     SET status = $2,
         synced_at = NOW(),
         updated_at = NOW(),
         last_error = NULL,
         resolution_outcome = COALESCE($3, resolution_outcome),
         conflict_details = COALESCE($4::jsonb, conflict_details)
     WHERE id = $1
     RETURNING *`,
    [
      operationId,
      SYNC_OPERATION_STATUS.SYNCED,
      resolution.outcome || null,
      resolution.details ? JSON.stringify(resolution.details) : null,
    ]
  );
  return mapRow(result.rows[0]);
};

const markFailed = async (pool, operationId, errorMessage, { incrementRetry = true } = {}) => {
  const result = await pool.query(
    `UPDATE sync_operations
     SET status = $2,
         last_error = $3,
         retry_count = CASE WHEN $4 THEN retry_count + 1 ELSE retry_count END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [operationId, SYNC_OPERATION_STATUS.FAILED, errorMessage, incrementRetry]
  );
  return mapRow(result.rows[0]);
};

const listOperations = async (pool, { status, limit = 50, offset = 0 } = {}) => {
  const params = [limit, offset];
  let where = '';
  if (status) {
    params.unshift(status);
    where = 'WHERE status = $1';
  }
  const result = await pool.query(
    `SELECT *
     FROM sync_operations
     ${where}
     ORDER BY updated_at DESC
     LIMIT ${status ? '$2' : '$1'}
     OFFSET ${status ? '$3' : '$2'}`,
    params
  );
  return result.rows.map(mapRow);
};

const getQueueStats = async (pool) => {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM sync_operations
     GROUP BY status`
  );
  const stats = {
    pending: 0,
    processing: 0,
    synced: 0,
    failed: 0,
    total: 0,
  };
  result.rows.forEach((row) => {
    const key = row.status;
    if (stats[key] !== undefined) stats[key] = row.count;
    stats.total += row.count;
  });
  return stats;
};

module.exports = {
  buildOrderingKey,
  ensureSchema,
  findByClientId,
  findById,
  insertOperation,
  markProcessing,
  markSynced,
  markFailed,
  listOperations,
  getQueueStats,
};
