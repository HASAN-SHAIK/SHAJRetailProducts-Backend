const { jsonError, jsonOk } = require('../utils/responses');
const { rabbitmqConfig } = require('../config/rabbitmq.config');
const {
  ingestOperationsBatch,
  processOperationInline,
  getMonitoringSnapshot,
} = require('../messaging/sync/syncOperation.service');
const { register } = require('../messaging/sync/syncMetrics');

const getRequestPool = (req) => req.tenantPool;

const buildContext = (req) => ({
  tenantId: req.tenant_id || req.tenant?.id,
  tenantDatabase: req.tenant?.database_name,
  userId: req.user?.user_id,
});

const submitSyncOperations = async (req, res) => {
  const operations = Array.isArray(req.body?.operations)
    ? req.body.operations
    : req.body?.operation
      ? [req.body.operation]
      : [];

  if (operations.length === 0) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'operations must be a non-empty array.');
  }

  const pool = getRequestPool(req);
  const context = buildContext(req);
  if (!context.tenantDatabase) {
    return jsonError(res, 400, 'TENANT_CONTEXT_MISSING', 'Tenant database is not available.');
  }

  try {
    if (rabbitmqConfig.enabled) {
      const results = await ingestOperationsBatch(pool, operations, context);
      const accepted = results.filter((entry) => entry.ok).length;
      const failed = results.length - accepted;
      return jsonOk(
        res,
        { results },
        undefined,
        {
          accepted,
          failed,
          mode: 'rabbitmq',
        }
      );
    }

    const results = [];
    for (const operation of operations) {
      try {
        const applied = await processOperationInline(pool, operation, context);
        results.push({ ok: true, ...applied });
      } catch (error) {
        results.push({
          ok: false,
          clientId: operation?.clientId || operation?.client_id || null,
          error: error.message,
          code: error.code || 'SYNC_FAILED',
        });
      }
    }

    const accepted = results.filter((entry) => entry.ok).length;
    const failed = results.length - accepted;
    return jsonOk(
      res,
      { results },
      undefined,
      {
        accepted,
        failed,
        mode: 'inline',
      }
    );
  } catch (error) {
    return jsonError(res, 500, 'SYNC_INGEST_FAILED', error.message);
  }
};

const getSyncOperationsStatus = async (req, res) => {
  const pool = getRequestPool(req);
  try {
    const snapshot = await getMonitoringSnapshot(pool);
    return jsonOk(res, snapshot);
  } catch (error) {
    return jsonError(res, 500, 'SYNC_STATUS_FAILED', error.message);
  }
};

const getSyncMetrics = async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    return res.status(200).send(await register.metrics());
  } catch (error) {
    return jsonError(res, 500, 'METRICS_FAILED', error.message);
  }
};

module.exports = {
  submitSyncOperations,
  getSyncOperationsStatus,
  getSyncMetrics,
};
