const { resolvePlanDeviceLimit, normalizePlan } = require('../config/planDeviceLimits');

const normalizeDeviceId = (value) => {
  const id = value ? String(value).trim() : '';
  return id.length > 0 ? id : null;
};

const parseNumber = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveBranchDeviceLimit = (branchRow) => {
  const plan = normalizePlan(branchRow?.subscription_plan);
  const override = parseNumber(branchRow?.max_devices_allowed);

  if (plan === 'enterprise') {
    if (override && override > 0) return override;
    return null;
  }
  if (override && override > 0) return override;
  return resolvePlanDeviceLimit(plan);
};

const isUndefinedColumn = (error) => error?.code === '42703' || String(error?.message || '').toLowerCase().includes('column "is_active" does not exist');

const fetchBranchPolicy = async (tenantPool, branchId) => {
  let result;
  try {
    result = await tenantPool.query(
      `SELECT id, subscription_plan, max_devices_allowed, is_active
       FROM branches
       WHERE id = $1`,
      [branchId]
    );
  } catch (error) {
    if (!isUndefinedColumn(error)) throw error;
    result = await tenantPool.query(
      `SELECT id, subscription_plan, max_devices_allowed, TRUE AS is_active
       FROM branches
       WHERE id = $1`,
      [branchId]
    );
  }
  return result.rows[0] || null;
};

const logDeviceEvent = async (tenantPool, payload) => {
  try {
    await tenantPool.query(
      `INSERT INTO branch_device_logs (branch_id, user_id, device_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [payload.branch_id, payload.user_id || null, payload.device_id || null, payload.action, payload.metadata ? JSON.stringify(payload.metadata) : null]
    );
  } catch (error) {
    console.error('Failed to log device event:', error.message || error);
  }
};

const ensureDeviceRegistration = async ({ tenantPool, branchId, deviceId, userId, mode = 'register', deviceInfo = {} }) => {
  if (!branchId || !deviceId) return { allowed: false, code: 'DEVICE_CONTEXT_MISSING' };

  const branch = await fetchBranchPolicy(tenantPool, branchId);
  if (!branch) return { allowed: false, code: 'BRANCH_NOT_FOUND' };
  if (branch.is_active === false) return { allowed: false, code: 'BRANCH_INACTIVE' };

  const maxAllowed = resolveBranchDeviceLimit(branch);
  const now = new Date();

  const otherActiveBranchRes = await tenantPool.query(
    `SELECT id, branch_id FROM branch_devices
     WHERE device_id = $1 AND branch_id <> $2 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [deviceId, branchId]
  );
  if (otherActiveBranchRes.rowCount > 0) {
    const currentBranchId = otherActiveBranchRes.rows[0]?.branch_id || null;
    await logDeviceEvent(tenantPool, { branch_id: branchId, user_id: userId, device_id: deviceId, action: 'DEVICE_BRANCH_CONFLICT', metadata: { current_branch_id: currentBranchId, requested_branch_id: branchId } });
    return { allowed: false, code: 'DEVICE_BRANCH_CONFLICT', currentBranchId, requestedBranchId: branchId, limit: maxAllowed };
  }

  const existingRes = await tenantPool.query(
    `SELECT id, is_active FROM branch_devices WHERE branch_id = $1 AND device_id = $2`,
    [branchId, deviceId]
  );
  const existing = existingRes.rows[0] || null;

  if (existing) {
    if (!existing.is_active) {
      if (maxAllowed !== null) {
        const countRes = await tenantPool.query(`SELECT COUNT(*)::int AS count FROM branch_devices WHERE branch_id = $1 AND is_active = TRUE`, [branchId]);
        if (countRes.rows[0].count >= maxAllowed) {
          await logDeviceEvent(tenantPool, { branch_id: branchId, user_id: userId, device_id: deviceId, action: 'DEVICE_LOGIN_BLOCKED', metadata: { reason: 'limit_reached', limit: maxAllowed } });
          return { allowed: false, code: 'DEVICE_LIMIT_REACHED', limit: maxAllowed };
        }
      }
      if (mode === 'validate') return { allowed: false, code: 'DEVICE_INACTIVE' };
      await tenantPool.query(
        `UPDATE branch_devices SET is_active = TRUE, last_login_at = $1, user_id = $2, device_name = $3, browser_info = $4, os_info = $5, ip_address = $6 WHERE id = $7`,
        [now, userId || null, deviceInfo.device_name || null, deviceInfo.browser_info || null, deviceInfo.os_info || null, deviceInfo.ip_address || null, existing.id]
      );
      await logDeviceEvent(tenantPool, { branch_id: branchId, user_id: userId, device_id: deviceId, action: 'DEVICE_REACTIVATED', metadata: { limit: maxAllowed } });
      return { allowed: true, limit: maxAllowed };
    }

    await tenantPool.query(
      `UPDATE branch_devices SET last_login_at = $1, user_id = $2, device_name = $3, browser_info = $4, os_info = $5, ip_address = $6 WHERE id = $7`,
      [now, userId || null, deviceInfo.device_name || null, deviceInfo.browser_info || null, deviceInfo.os_info || null, deviceInfo.ip_address || null, existing.id]
    );
    return { allowed: true, limit: maxAllowed };
  }

  if (mode === 'validate') return { allowed: false, code: 'DEVICE_NOT_REGISTERED', limit: maxAllowed };

  if (maxAllowed !== null) {
    const countRes = await tenantPool.query(`SELECT COUNT(*)::int AS count FROM branch_devices WHERE branch_id = $1 AND is_active = TRUE`, [branchId]);
    if (countRes.rows[0].count >= maxAllowed) {
      await logDeviceEvent(tenantPool, { branch_id: branchId, user_id: userId, device_id: deviceId, action: 'DEVICE_LOGIN_BLOCKED', metadata: { reason: 'limit_reached', limit: maxAllowed } });
      return { allowed: false, code: 'DEVICE_LIMIT_REACHED', limit: maxAllowed };
    }
  }

  await tenantPool.query(
    `INSERT INTO branch_devices (branch_id, user_id, device_id, device_name, browser_info, os_info, ip_address, last_login_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)`,
    [branchId, userId || null, deviceId, deviceInfo.device_name || null, deviceInfo.browser_info || null, deviceInfo.os_info || null, deviceInfo.ip_address || null, now]
  );
  await logDeviceEvent(tenantPool, { branch_id: branchId, user_id: userId, device_id: deviceId, action: 'DEVICE_REGISTERED', metadata: { limit: maxAllowed } });
  return { allowed: true, limit: maxAllowed };
};

const sanitizeDeviceContext = (req) => {
  const deviceId = normalizeDeviceId(req.body?.device_id || req.headers['x-device-id']);
  const userAgent = req.headers['user-agent'] || '';
  return { deviceId, deviceInfo: { device_name: req.body?.device_name || req.headers['x-device-name'] || null, browser_info: userAgent || null, os_info: req.headers['x-os-info'] || null, ip_address: req.headers['x-forwarded-for'] || req.ip || null } };
};

module.exports = { resolveBranchDeviceLimit, fetchBranchPolicy, ensureDeviceRegistration, sanitizeDeviceContext };
