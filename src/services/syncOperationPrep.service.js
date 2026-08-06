/**
 * Server-side sync preparation constants.
 * Routes and processors are intentionally not registered in this phase.
 */

const SYNC_OPERATION_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SYNCED: 'synced',
  FAILED: 'failed',
});

const SYNC_OPERATION_ACTION = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
});

const SYNC_ERROR_CODE = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SYNC_CONFLICT: 'SYNC_CONFLICT',
  HANDLER_NOT_FOUND: 'HANDLER_NOT_FOUND',
  MAX_RETRIES: 'MAX_RETRIES',
  INVENTORY_PROTECTION: 'INVENTORY_PROTECTION',
  DUPLICATE_SALE: 'DUPLICATE_SALE',
});

const SYNC_RESOLUTION_OUTCOME = Object.freeze({
  APPLY: 'apply',
  SKIP_DUPLICATE: 'skip_duplicate',
  SERVER_WINS: 'server_wins',
  CLIENT_WINS: 'client_wins',
  CONFLICT: 'conflict',
  SKIP_DELETED: 'skip_deleted',
});

module.exports = {
  SYNC_OPERATION_STATUS,
  SYNC_OPERATION_ACTION,
  SYNC_ERROR_CODE,
  SYNC_RESOLUTION_OUTCOME,
};
