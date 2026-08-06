const { SYNC_OPERATION_STATUS } = require('../../../services/syncOperationPrep.service');
const { applySalesOrderOperation } = require('./salesOrderHandler');
const {
  resolveSyncConflict,
  resolutionToConflictError,
  isResolvedWithoutApply,
} = require('../conflictResolver');
const { RESOLUTION_OUTCOME } = require('../conflictResolutionPolicy');

const dispatchSyncHandler = async (context = {}) => {
  const { tenantPool, module, entityType, action, payload, userId } = context;

  const resolution = await resolveSyncConflict({
    tenantPool,
    module,
    entityType,
    entityId: context.entityId,
    action,
    payload,
  });

  if (resolution.outcome === RESOLUTION_OUTCOME.CONFLICT) {
    throw resolutionToConflictError(resolution, {
      entityType,
      entityId: context.entityId,
      payload,
    });
  }

  if (isResolvedWithoutApply(resolution)) {
    return {
      resolved: true,
      duplicate: resolution.outcome === RESOLUTION_OUTCOME.SKIP_DUPLICATE,
      outcome: resolution.outcome,
      reason: resolution.reason,
      entityId: resolution.serverEntityId,
      serverState: resolution.serverState,
      details: resolution.details,
    };
  }

  const effectivePayload = resolution.payload || payload;

  if (module === 'sales' && entityType === 'order') {
    return applySalesOrderOperation({
      tenantPool,
      userId,
      payload: effectivePayload,
      action,
      resolution,
    });
  }

  const error = new Error(`No sync handler registered for ${module}/${entityType}.`);
  error.code = 'HANDLER_NOT_FOUND';
  error.retryable = false;
  throw error;
};

const isAlreadySynced = (record) => record?.status === SYNC_OPERATION_STATUS.SYNCED;

module.exports = {
  dispatchSyncHandler,
  isAlreadySynced,
};
