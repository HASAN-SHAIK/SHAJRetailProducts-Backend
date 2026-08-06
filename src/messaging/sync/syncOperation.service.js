const { rabbitmqConfig } = require('../../config/rabbitmq.config');
const { getTenantPool } = require('../../db/tenantPool');
const {
  SYNC_OPERATION_STATUS,
} = require('../../services/syncOperationPrep.service');
const {
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
} = require('./syncOperation.repository');
const { publishSyncEvent, publishRetryEvent, publishDeadLetterEvent } = require('../rabbitmq/publisher');
const { dispatchSyncHandler, isAlreadySynced } = require('./handlers');
const { extractSourceUpdatedAt, extractSourceVersion, isConflictError } = require('./conflictDetector');
const { orderingGate } = require('./orderingGate');
const { syncLogger } = require('./syncLogger');
const {
  recordConsumed,
  recordConflict,
  recordDlq,
  recordRetry,
  startProcessingTimer,
} = require('./syncMetrics');

const normalizeIncomingOperation = (operation = {}, context = {}) => {
  const clientId = operation.clientId || operation.client_id;
  if (!clientId) {
    const error = new Error('clientId is required for sync idempotency.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const moduleName = operation.module || 'general';
  const entityType = operation.entityType || operation.entity_type || 'unknown';
  const entityId = operation.entityId || operation.entity_id || null;
  const action = String(operation.action || 'UPDATE').toUpperCase();
  const payload = operation.payload || {};
  const tenantId = context.tenantId;
  const orderingKey = buildOrderingKey({
    tenantId,
    module: moduleName,
    entityType,
    entityId,
    clientId,
  });

  return {
    clientId,
    module: moduleName,
    entityType,
    entityId,
    action,
    payload,
    orderingKey,
    messageId: clientId,
    sourceUpdatedAt: extractSourceUpdatedAt(payload),
    sourceVersion: extractSourceVersion(payload),
    createdBy: context.userId || null,
    tenantId,
    tenantDatabase: context.tenantDatabase,
  };
};

const buildEventFromRecord = (record, context = {}) => ({
  operationId: record.id,
  clientId: record.clientId,
  tenantId: context.tenantId,
  tenantDatabase: context.tenantDatabase,
  module: record.module,
  entityType: record.entityType,
  entityId: record.entityId,
  action: record.action,
  payload: record.payload,
  orderingKey: record.orderingKey,
  sourceUpdatedAt: record.sourceUpdatedAt,
  userId: context.userId || record.createdBy,
});

const ingestOperation = async (tenantPool, operation, context = {}) => {
  await ensureSchema(tenantPool);
  const normalized = normalizeIncomingOperation(operation, context);
  const { record, created } = await insertOperation(tenantPool, normalized);

  if (!record) {
    const error = new Error('Failed to persist sync operation.');
    error.code = 'PERSISTENCE_ERROR';
    throw error;
  }

  if (isAlreadySynced(record)) {
    return {
      clientId: record.clientId,
      operationId: record.id,
      status: record.status,
      duplicate: true,
      queued: false,
      created,
    };
  }

  let queued = false;
  if (rabbitmqConfig.enabled) {
    const publishResult = await publishSyncEvent(buildEventFromRecord(record, context));
    queued = publishResult.published === true;
  }

  return {
    clientId: record.clientId,
    operationId: record.id,
    status: record.status,
    duplicate: !created && isAlreadySynced(record),
    queued,
    created,
  };
};

const ingestOperationsBatch = async (tenantPool, operations = [], context = {}) => {
  const results = [];
  for (const operation of operations) {
    try {
      const result = await ingestOperation(tenantPool, operation, context);
      results.push({ ...result, ok: true });
    } catch (error) {
      results.push({
        ok: false,
        clientId: operation?.clientId || operation?.client_id || null,
        error: error.message,
        code: error.code || 'INGEST_FAILED',
      });
    }
  }
  return results;
};

const processSyncEvent = async (event = {}) => {
  const tenantDatabase = event.tenantDatabase;
  if (!tenantDatabase) {
    const error = new Error('tenantDatabase is required in sync event.');
    error.retryable = false;
    throw error;
  }

  const tenantPool = getTenantPool(tenantDatabase);
  await ensureSchema(tenantPool);

  let record =
    (event.operationId && (await findById(tenantPool, event.operationId))) ||
    (event.clientId && (await findByClientId(tenantPool, event.clientId)));

  if (!record) {
    const error = new Error('Sync operation record not found.');
    error.retryable = false;
    throw error;
  }

  if (isAlreadySynced(record)) {
    return { skipped: true, reason: 'already_synced', operationId: record.id };
  }

  const stopTimer = startProcessingTimer({ module: record.module, action: record.action });

  try {
    const locked = await markProcessing(tenantPool, record.id);
    if (!locked) {
      const latest = await findById(tenantPool, record.id);
      if (isAlreadySynced(latest)) {
        return { skipped: true, reason: 'already_synced', operationId: record.id };
      }
    }

    const handlerResult = await dispatchSyncHandler({
      tenantPool,
      module: record.module,
      entityType: record.entityType,
      entityId: record.entityId,
      action: record.action,
      payload: record.payload,
      userId: event.userId || record.createdBy,
    });

    const resolutionMeta = handlerResult?.resolved
      ? {
          outcome: handlerResult.outcome,
          details: {
            reason: handlerResult.reason,
            entity_id: handlerResult.entityId,
            ...(handlerResult.details || {}),
          },
        }
      : handlerResult?.resolution
        ? {
            outcome: handlerResult.resolution.outcome,
            details: handlerResult.resolution.details || null,
          }
        : null;

    await markSynced(tenantPool, record.id, resolutionMeta);
    recordConsumed({
      module: record.module,
      action: record.action,
      result: handlerResult?.resolved ? handlerResult.outcome : 'success',
    });
    syncLogger.info('sync_operation_applied', {
      operationId: record.id,
      clientId: record.clientId,
      module: record.module,
      entityType: record.entityType,
      duplicate: handlerResult?.duplicate === true,
      resolved: handlerResult?.resolved === true,
      resolutionOutcome: resolutionMeta?.outcome || null,
    });

    return {
      operationId: record.id,
      clientId: record.clientId,
      status: SYNC_OPERATION_STATUS.SYNCED,
      handlerResult,
      resolution: resolutionMeta,
    };
  } catch (error) {
    const retryable = error.retryable !== false && !isConflictError(error);
    const message = isConflictError(error)
      ? JSON.stringify({ code: 'SYNC_CONFLICT', ...error.conflict })
      : error.message;

    await markFailed(tenantPool, record.id, message, { incrementRetry: retryable });

    if (isConflictError(error)) {
      recordConflict({ module: record.module, entityType: record.entityType });
      recordConsumed({ module: record.module, action: record.action, result: 'conflict' });
      error.retryable = false;
      throw error;
    }

    recordConsumed({
      module: record.module,
      action: record.action,
      result: retryable ? 'retry' : 'failed',
    });
    throw error;
  } finally {
    stopTimer();
  }
};

const processSyncEventInOrder = (event = {}) =>
  orderingGate.run(event.orderingKey, () => processSyncEvent(event));

const processOperationInline = async (tenantPool, operation, context = {}) => {
  const ingested = await ingestOperation(tenantPool, operation, context);
  if (ingested.duplicate && ingested.status === SYNC_OPERATION_STATUS.SYNCED) {
    return ingested;
  }

  const record = await findByClientId(tenantPool, ingested.clientId);
  const applied = await processSyncEvent(
    buildEventFromRecord(record, {
      ...context,
      userId: context.userId,
    })
  );
  return { ...ingested, applied };
};

const getMonitoringSnapshot = async (tenantPool) => {
  await ensureSchema(tenantPool);
  const [stats, recent] = await Promise.all([
    getQueueStats(tenantPool),
    listOperations(tenantPool, { limit: 20 }),
  ]);
  return {
    rabbitmqEnabled: rabbitmqConfig.enabled,
    orderingPartitions: orderingGate.size(),
    stats,
    recent,
  };
};

const handleConsumerFailure = async (event, error, retryCount = 0) => {
  if (isConflictError(error) || error.retryable === false) {
    await publishDeadLetterEvent(event, error.code || 'non_retryable');
    recordDlq({ module: event.module, reason: error.code || 'non_retryable' });
    return { action: 'dlq', reason: error.code || 'non_retryable' };
  }

  const nextRetry = retryCount + 1;
  if (nextRetry >= rabbitmqConfig.maxRetries) {
    await publishDeadLetterEvent(event, 'max_retries');
    recordDlq({ module: event.module, reason: 'max_retries' });
    return { action: 'dlq', reason: 'max_retries' };
  }

  recordRetry({ module: event.module });
  await publishRetryEvent(event, nextRetry);
  return { action: 'retry', retryCount: nextRetry };
};

module.exports = {
  ingestOperation,
  ingestOperationsBatch,
  processSyncEvent,
  processSyncEventInOrder,
  processOperationInline,
  getMonitoringSnapshot,
  handleConsumerFailure,
  normalizeIncomingOperation,
  buildEventFromRecord,
};
