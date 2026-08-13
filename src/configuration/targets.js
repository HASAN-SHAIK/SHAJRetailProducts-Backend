const { errorWithStatus, normalizeScopeType } = require('./validation');

const getRequestPool = (req) => {
  if (!req?.tenantPool) {
    throw errorWithStatus(500, 'TENANT_POOL_MISSING', 'Tenant database context is unavailable');
  }
  return req.tenantPool;
};

const getTenantScopeId = (req) => String(req?.tenant?.id || req?.tenant_id || 'tenant');

const resolveBranch = async (requestPool, branchId) => {
  if (!branchId) return null;
  const result = await requestPool.query(
    `SELECT id FROM branches WHERE id::text = $1 LIMIT 1`,
    [String(branchId)]
  );
  if (!result.rowCount) throw errorWithStatus(404, 'BRANCH_NOT_FOUND', 'Branch not found');
  return String(result.rows[0].id);
};

const resolveDevice = async (requestPool, deviceId, { requireActive = false } = {}) => {
  if (!deviceId) return null;
  const result = await requestPool.query(
    `SELECT id, device_id, branch_id, is_active
     FROM branch_devices
     WHERE device_id = $1 OR id::text = $1
     ORDER BY is_active DESC, created_at DESC
     LIMIT 1`,
    [String(deviceId)]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (requireActive && row.is_active !== true) return null;
  return {
    id: String(row.id),
    deviceId: String(row.device_id),
    branchId: row.branch_id === null || row.branch_id === undefined ? null : String(row.branch_id),
    active: row.is_active === true,
  };
};

const resolveTarget = async (req, scopeTypeInput, scopeIdInput) => {
  const requestPool = getRequestPool(req);
  const scopeType = normalizeScopeType(scopeTypeInput);
  const tenantId = getTenantScopeId(req);

  if (scopeType === 'tenant') {
    const requested = String(scopeIdInput || 'current');
    if (!['current', 'tenant', tenantId].includes(requested)) {
      throw errorWithStatus(403, 'CONFIG_SCOPE_FORBIDDEN', 'Tenant scope does not match the authenticated tenant');
    }
    return { scopeType, scopeId: tenantId, branchId: null, deviceId: null };
  }

  if (scopeType === 'branch') {
    const branchId = await resolveBranch(requestPool, scopeIdInput);
    return { scopeType, scopeId: branchId, branchId, deviceId: null };
  }

  const device = await resolveDevice(requestPool, scopeIdInput);
  if (!device) throw errorWithStatus(404, 'DEVICE_NOT_FOUND', 'Device not found');
  return {
    scopeType,
    scopeId: device.deviceId,
    branchId: device.branchId,
    deviceId: device.deviceId,
  };
};

module.exports = {
  getRequestPool,
  getTenantScopeId,
  resolveBranch,
  resolveDevice,
  resolveTarget,
};
