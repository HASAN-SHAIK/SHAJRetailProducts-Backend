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
    `SELECT id FROM branches WHERE id::text = $1 AND is_active = TRUE LIMIT 1`,
    [String(branchId)]
  );
  if (!result.rowCount) throw errorWithStatus(404, 'BRANCH_NOT_FOUND', 'Active branch not found');
  return String(result.rows[0].id);
};

const resolveDevice = async (requestPool, deviceId, { requireActive = false } = {}) => {
  if (!deviceId) return null;
  const result = await requestPool.query(
    `SELECT d.id, d.device_id, d.branch_id, d.is_active, b.is_active AS branch_is_active
     FROM branch_devices d
     JOIN branches b ON b.id = d.branch_id
     WHERE d.device_id = $1 OR d.id::text = $1
     ORDER BY d.is_active DESC, d.created_at DESC
     LIMIT 2`,
    [String(deviceId)]
  );
  if (!result.rowCount) return null;
  const activeRows = result.rows.filter((candidate) => candidate.is_active === true && candidate.branch_is_active === true);
  if (activeRows.length > 1) return null;
  const row = activeRows[0] || result.rows[0];
  if (requireActive && (row.is_active !== true || row.branch_is_active !== true)) return null;
  return {
    id: String(row.id),
    deviceId: String(row.device_id),
    branchId: row.branch_id === null || row.branch_id === undefined ? null : String(row.branch_id),
    active: row.is_active === true && row.branch_is_active === true,
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
  return { scopeType, scopeId: device.deviceId, branchId: device.branchId, deviceId: device.deviceId };
};

module.exports = { getRequestPool, getTenantScopeId, resolveBranch, resolveDevice, resolveTarget };
