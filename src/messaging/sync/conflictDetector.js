const parseTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const extractSourceUpdatedAt = (payload = {}) =>
  parseTimestamp(
    payload.updated_at ||
      payload.updatedAt ||
      payload.source_updated_at ||
      payload.sourceUpdatedAt ||
      payload.last_modified ||
      payload.lastModified ||
      payload.version_timestamp
  );

const extractSourceVersion = (payload = {}) => {
  const raw =
    payload.sync_version ??
    payload.syncVersion ??
    payload.version_number ??
    payload.versionNumber ??
    payload.version;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildConflictError = ({
  reason,
  entityType,
  entityId,
  serverUpdatedAt,
  sourceUpdatedAt,
  serverVersion,
  sourceVersion,
  details,
}) => {
  const error = new Error('Sync conflict detected.');
  error.code = 'SYNC_CONFLICT';
  error.retryable = false;
  error.conflict = {
    reason: reason || 'unknown',
    entity_type: entityType,
    entity_id: entityId,
    server_updated_at: serverUpdatedAt?.toISOString?.() || serverUpdatedAt || null,
    source_updated_at: sourceUpdatedAt?.toISOString?.() || sourceUpdatedAt || null,
    server_version: serverVersion ?? null,
    source_version: sourceVersion ?? null,
    details: details || null,
  };
  return error;
};

const isConflictError = (error) => error?.code === 'SYNC_CONFLICT';

module.exports = {
  parseTimestamp,
  extractSourceUpdatedAt,
  extractSourceVersion,
  buildConflictError,
  isConflictError,
};
