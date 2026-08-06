const {
  RESOLUTION_OUTCOME,
  MERGE_STRATEGY,
  CONFLICT_REASON,
  getEntityRule,
  TIMESTAMP_TOLERANCE_MS,
} = require('./conflictResolutionPolicy');
const {
  extractSourceUpdatedAt,
  extractSourceVersion,
  buildConflictError,
  parseTimestamp,
} = require('./conflictDetector');
const {
  loadServerEntityState,
  extractServerUpdatedAt,
  extractServerVersion,
} = require('./entityStateLoader');
const { checkDuplicateSale } = require('./duplicateSalesGuard');
const { validateInventoryProtection } = require('./inventoryGuard');

const getNestedValue = (source, field) => {
  if (!source || !field) return undefined;
  if (source[field] !== undefined) return source[field];
  const nested = source.order || source.product || null;
  return nested?.[field];
};

const applyMergeFields = (clientPayload = {}, serverRow = {}, mergeFields = []) => {
  const orderPayload = clientPayload?.order ? { ...clientPayload.order } : { ...clientPayload };
  mergeFields.forEach((field) => {
    const clientValue = getNestedValue(clientPayload, field);
    if (clientValue !== undefined) {
      orderPayload[field] = clientValue;
    } else if (serverRow[field] !== undefined) {
      orderPayload[field] = serverRow[field];
    }
  });

  if (clientPayload?.order) {
    return { ...clientPayload, order: orderPayload };
  }
  return orderPayload;
};

const buildResolution = ({
  outcome,
  reason,
  payload,
  serverState,
  serverEntityId,
  details,
}) => ({
  outcome,
  reason: reason || null,
  payload: payload ?? null,
  serverState: serverState || null,
  serverEntityId: serverEntityId ?? serverState?.id ?? null,
  details: details || null,
});

const compareVersions = ({ clientVersion, serverVersion, rule }) => {
  if (clientVersion == null || serverVersion == null) return null;
  if (rule.strategy !== MERGE_STRATEGY.VERSION_WINS && clientVersion === serverVersion) {
    return null;
  }
  if (serverVersion > clientVersion) {
    return buildResolution({
      outcome: RESOLUTION_OUTCOME.SERVER_WINS,
      reason: CONFLICT_REASON.VERSION,
      details: { serverVersion, clientVersion },
    });
  }
  if (clientVersion > serverVersion) {
    return buildResolution({
      outcome: RESOLUTION_OUTCOME.CLIENT_WINS,
      reason: CONFLICT_REASON.VERSION,
      details: { serverVersion, clientVersion },
    });
  }
  return null;
};

const compareLastModified = ({ clientUpdatedAt, serverUpdatedAt, rule, clientPayload, serverState }) => {
  if (!clientUpdatedAt || !serverUpdatedAt) return null;

  const delta = serverUpdatedAt.getTime() - clientUpdatedAt.getTime();
  if (delta > 0) {
    return buildResolution({
      outcome: RESOLUTION_OUTCOME.SERVER_WINS,
      reason: CONFLICT_REASON.LAST_MODIFIED,
      serverState,
      details: {
        server_updated_at: serverUpdatedAt.toISOString(),
        source_updated_at: clientUpdatedAt.toISOString(),
      },
    });
  }

  if (delta < 0) {
    return buildResolution({
      outcome: RESOLUTION_OUTCOME.CLIENT_WINS,
      reason: CONFLICT_REASON.LAST_MODIFIED,
      payload: clientPayload,
      serverState,
    });
  }

  if (Math.abs(delta) <= TIMESTAMP_TOLERANCE_MS && rule.mergeFields?.length) {
    return buildResolution({
      outcome: RESOLUTION_OUTCOME.APPLY,
      reason: CONFLICT_REASON.CONCURRENT_MERGE,
      payload: applyMergeFields(clientPayload, serverState, rule.mergeFields),
      serverState,
      details: { merged_fields: rule.mergeFields },
    });
  }

  return buildResolution({
    outcome: RESOLUTION_OUTCOME.APPLY,
    reason: CONFLICT_REASON.LAST_MODIFIED,
    payload: clientPayload,
    serverState,
  });
};

const resolveSyncConflict = async ({
  tenantPool,
  module,
  entityType,
  entityId,
  action,
  payload = {},
}) => {
  const normalizedAction = String(action || 'UPDATE').toUpperCase();
  const rule = getEntityRule(module, entityType, normalizedAction);
  const serverState = await loadServerEntityState({
    tenantPool,
    module,
    entityType,
    entityId,
    payload,
  });

  if (rule.preventDuplicateSales && normalizedAction === 'CREATE') {
    const duplicate = await checkDuplicateSale(tenantPool, payload);
    if (duplicate) {
      return buildResolution({
        outcome: RESOLUTION_OUTCOME.SKIP_DUPLICATE,
        reason: CONFLICT_REASON.DUPLICATE_SALE,
        serverState: duplicate.serverRow,
        serverEntityId: duplicate.serverEntityId,
        details: { client_order_id: duplicate.clientOrderId },
      });
    }
  }

  if (serverState?.is_deleted) {
    if (normalizedAction === 'DELETE') {
      return buildResolution({
        outcome: RESOLUTION_OUTCOME.SKIP_DUPLICATE,
        reason: CONFLICT_REASON.ALREADY_ABSENT,
        serverState,
        serverEntityId: serverState.id,
      });
    }
    if (rule.respectTombstone !== false) {
      return buildResolution({
        outcome: RESOLUTION_OUTCOME.SKIP_DELETED,
        reason: CONFLICT_REASON.DELETED_ON_SERVER,
        serverState,
        serverEntityId: serverState.id,
      });
    }
  }

  if (!serverState && normalizedAction === 'DELETE') {
    return buildResolution({
      outcome: RESOLUTION_OUTCOME.SKIP_DUPLICATE,
      reason: CONFLICT_REASON.ALREADY_ABSENT,
    });
  }

  if (!serverState && (normalizedAction === 'CREATE' || normalizedAction === 'UPDATE')) {
    if (rule.inventoryProtection) {
      const inventory = await validateInventoryProtection(tenantPool, {
        module,
        entityType,
        payload,
        serverState,
        action: normalizedAction,
      });
      if (!inventory.ok) {
        return buildResolution({
          outcome: RESOLUTION_OUTCOME.CONFLICT,
          reason: CONFLICT_REASON.INVENTORY_PROTECTION,
          details: inventory,
        });
      }
    }
    return buildResolution({
      outcome: RESOLUTION_OUTCOME.APPLY,
      reason: null,
      payload,
    });
  }

  const clientVersion = extractSourceVersion(payload);
  const serverVersion = extractServerVersion(serverState);
  const versionResolution =
    rule.strategy === MERGE_STRATEGY.VERSION_WINS || clientVersion != null
      ? compareVersions({ clientVersion, serverVersion, rule })
      : null;

  if (versionResolution?.outcome === RESOLUTION_OUTCOME.SERVER_WINS) {
    return versionResolution;
  }

  const clientUpdatedAt = extractSourceUpdatedAt(payload);
  const serverUpdatedAt = parseTimestamp(extractServerUpdatedAt(serverState));
  const timeResolution = compareLastModified({
    clientUpdatedAt,
    serverUpdatedAt,
    rule,
    clientPayload: payload,
    serverState,
  });

  let resolution = timeResolution;
  if (
    versionResolution?.outcome === RESOLUTION_OUTCOME.CLIENT_WINS &&
    resolution?.outcome !== RESOLUTION_OUTCOME.SERVER_WINS
  ) {
    resolution = versionResolution;
  }

  if (!resolution) {
    resolution = buildResolution({
      outcome: RESOLUTION_OUTCOME.APPLY,
      payload,
      serverState,
    });
  }

  if (
    resolution.outcome === RESOLUTION_OUTCOME.APPLY ||
    resolution.outcome === RESOLUTION_OUTCOME.CLIENT_WINS
  ) {
    if (rule.inventoryProtection) {
      const inventory = await validateInventoryProtection(tenantPool, {
        module,
        entityType,
        payload: resolution.payload || payload,
        serverState,
        action: normalizedAction,
      });
      if (!inventory.ok) {
        return buildResolution({
          outcome: RESOLUTION_OUTCOME.CONFLICT,
          reason: CONFLICT_REASON.INVENTORY_PROTECTION,
          serverState,
          details: inventory,
        });
      }
    }
    if (resolution.outcome === RESOLUTION_OUTCOME.CLIENT_WINS) {
      return buildResolution({
        ...resolution,
        outcome: RESOLUTION_OUTCOME.APPLY,
      });
    }
  }

  return resolution;
};

const resolutionToConflictError = (resolution, { entityType, entityId, payload }) => {
  const clientUpdatedAt = extractSourceUpdatedAt(payload);
  const serverUpdatedAt = parseTimestamp(extractServerUpdatedAt(resolution.serverState));
  return buildConflictError({
    reason: resolution.reason,
    entityType,
    entityId,
    serverUpdatedAt,
    sourceUpdatedAt: clientUpdatedAt,
    serverVersion: extractServerVersion(resolution.serverState),
    sourceVersion: extractSourceVersion(payload),
    details: resolution.details,
  });
};

const isResolvedWithoutApply = (resolution) =>
  resolution?.outcome === RESOLUTION_OUTCOME.SKIP_DUPLICATE ||
  resolution?.outcome === RESOLUTION_OUTCOME.SERVER_WINS ||
  resolution?.outcome === RESOLUTION_OUTCOME.SKIP_DELETED;

/**
 * @deprecated Use resolveSyncConflict instead.
 */
const detectTimestampConflict = async (context = {}) => {
  const resolution = await resolveSyncConflict(context);
  if (resolution.outcome === RESOLUTION_OUTCOME.CONFLICT) {
    return resolutionToConflictError(resolution, context);
  }
  if (resolution.outcome === RESOLUTION_OUTCOME.SERVER_WINS) {
    return resolutionToConflictError(resolution, context);
  }
  return null;
};

module.exports = {
  resolveSyncConflict,
  resolutionToConflictError,
  isResolvedWithoutApply,
  applyMergeFields,
  detectTimestampConflict,
};
