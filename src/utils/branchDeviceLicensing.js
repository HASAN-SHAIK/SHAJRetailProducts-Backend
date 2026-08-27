const { resolvePlanDeviceLimit, normalizePlan } = require('../config/planDeviceLimits');

const normalizeDeviceId = (value) => {
  const id = value ? String(value).trim() : '';
  return id.length > 0 ? id : null;
};
const normalizeCode = (value) => String(value || '').trim().toUpperCase();
const parseNumber = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveBranchDeviceLimit = (branchRow) => {
  const plan = normalizePlan(branchRow?.subscription_plan);
  const override = parseNumber(branchRow?.max_devices_allowed);
  if (plan === 'enterprise') return override && override > 0 ? override : null;
  if (override && override > 0) return override;
  return resolvePlanDeviceLimit(plan);
};

const isUndefinedColumn = (error) => error?.code === '42703' || String(error?.message || '').toLowerCase().includes('column "is_active" does not exist');

const fetchBranchPolicy = async (tenantPool, branchId) => {
  let result;
  try {
    result = await tenantPool.query(
      `SELECT id, store_number, subscription_plan, max_devices_allowed, is_active FROM branches WHERE id = $1`,
      [branchId]
    );
  } catch (error) {
    if (!isUndefinedColumn(error)) throw error;
    result = await tenantPool.query(
      `SELECT id, NULL::text AS store_number, subscription_plan, max_devices_allowed, TRUE AS is_active FROM branches WHERE id = $1`,
      [branchId]
    );
  }
  return result.rows[0] || null;
};

const logDeviceEvent = async (tenantPool, payload) => {
  try {
    await tenantPool.query(
      `INSERT INTO branch_device_logs (branch_id, user_id, device_id, action, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [payload.branch_id, payload.user_id || null, payload.device_id || null, payload.action, payload.metadata ? JSON.stringify(payload.metadata) : null]
    );
  } catch (error) { console.error('Failed to log device event:', error.message || error); }
};

const ensureDeviceRegistration = async ({ tenantPool, branchId, deviceId, userId, mode = 'register', deviceInfo = {}, businessIdentity = {} }) => {
  if (!branchId || !deviceId) return { allowed: false, code: 'DEVICE_CONTEXT_MISSING' };
  const branch = await fetchBranchPolicy(tenantPool, branchId);
  if (!branch) return { allowed: false, code: 'BRANCH_NOT_FOUND' };
  if (branch.is_active === false) return { allowed: false, code: 'BRANCH_INACTIVE' };

  const storeNumber = normalizeCode(businessIdentity.store_number || branch.store_number);
  const posNo = normalizeCode(businessIdentity.pos_no || businessIdentity.terminal_id);
  const touchpointId = normalizeCode(businessIdentity.touchpoint_id);
  if (mode === 'register' && (!storeNumber || !posNo || !touchpointId)) {
    return { allowed: false, code: 'POS_BUSINESS_IDENTITY_REQUIRED' };
  }
  if (branch.store_number && storeNumber && normalizeCode(branch.store_number) !== storeNumber) {
    return { allowed: false, code: 'STORE_NUMBER_MISMATCH' };
  }

  const maxAllowed = resolveBranchDeviceLimit(branch);
  const now = new Date();
  const otherActiveBranchRes = await tenantPool.query(
    `SELECT id, branch_id FROM branch_devices WHERE device_id = $1 AND branch_id <> $2 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
    [deviceId, branchId]
  );
  if (otherActiveBranchRes.rowCount > 0) {
    const currentBranchId = otherActiveBranchRes.rows[0]?.branch_id || null;
    await logDeviceEvent(tenantPool, { branch_id: branchId, user_id: userId, device_id: deviceId, action: 'DEVICE_BRANCH_CONFLICT', metadata: { current_branch_id: currentBranchId, requested_branch_id: branchId } });
    return { allowed: false, code: 'DEVICE_BRANCH_CONFLICT', currentBranchId, requestedBranchId: branchId, limit: maxAllowed };
  }

  if (storeNumber && posNo && touchpointId) {
    const identityConflict = await tenantPool.query(
      `SELECT device_id FROM branch_devices
       WHERE UPPER(store_number)=$1 AND UPPER(pos_no)=$2 AND UPPER(touchpoint_id)=$3
         AND is_active=TRUE AND device_id <> $4 LIMIT 1`,
      [storeNumber, posNo, touchpointId, deviceId]
    );
    if (identityConflict.rowCount > 0) return { allowed: false, code: 'POS_IDENTITY_IN_USE', activeDeviceId: identityConflict.rows[0].device_id };
  }

  const existingRes = await tenantPool.query(`SELECT id, is_active FROM branch_devices WHERE branch_id = $1 AND device_id = $2`, [branchId, deviceId]);
  const existing = existingRes.rows[0] || null;
  if (existing) {
    if (!existing.is_active && mode === 'validate') return { allowed: false, code: 'DEVICE_INACTIVE' };
    if (!existing.is_active && maxAllowed !== null) {
      const countRes = await tenantPool.query(`SELECT COUNT(*)::int AS count FROM branch_devices WHERE branch_id = $1 AND is_active = TRUE`, [branchId]);
      if (countRes.rows[0].count >= maxAllowed) return { allowed: false, code: 'DEVICE_LIMIT_REACHED', limit: maxAllowed };
    }
    await tenantPool.query(
      `UPDATE branch_devices SET is_active=TRUE, last_login_at=$1, user_id=$2, device_name=$3, browser_info=$4, os_info=$5, ip_address=$6,
       store_number=COALESCE($7,store_number), pos_no=COALESCE($8,pos_no), touchpoint_id=COALESCE($9,touchpoint_id) WHERE id=$10`,
      [now, userId || null, deviceInfo.device_name || null, deviceInfo.browser_info || null, deviceInfo.os_info || null, deviceInfo.ip_address || null, storeNumber || null, posNo || null, touchpointId || null, existing.id]
    );
    return { allowed: true, limit: maxAllowed, storeNumber, posNo, touchpointId };
  }

  if (mode === 'validate') return { allowed: false, code: 'DEVICE_NOT_REGISTERED', limit: maxAllowed };
  if (maxAllowed !== null) {
    const countRes = await tenantPool.query(`SELECT COUNT(*)::int AS count FROM branch_devices WHERE branch_id = $1 AND is_active = TRUE`, [branchId]);
    if (countRes.rows[0].count >= maxAllowed) return { allowed: false, code: 'DEVICE_LIMIT_REACHED', limit: maxAllowed };
  }
  await tenantPool.query(
    `INSERT INTO branch_devices (branch_id,user_id,device_id,device_name,browser_info,os_info,ip_address,last_login_at,is_active,store_number,pos_no,touchpoint_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11)`,
    [branchId, userId || null, deviceId, deviceInfo.device_name || null, deviceInfo.browser_info || null, deviceInfo.os_info || null, deviceInfo.ip_address || null, now, storeNumber, posNo, touchpointId]
  );
  await logDeviceEvent(tenantPool, { branch_id: branchId, user_id: userId, device_id: deviceId, action: 'DEVICE_REGISTERED', metadata: { limit: maxAllowed, store_number: storeNumber, pos_no: posNo, touchpoint_id: touchpointId } });
  return { allowed: true, limit: maxAllowed, storeNumber, posNo, touchpointId };
};

const sanitizeDeviceContext = (req) => {
  const deviceId = normalizeDeviceId(req.body?.device_id || req.headers['x-device-id']);
  const userAgent = req.headers['user-agent'] || '';
  return {
    deviceId,
    deviceInfo: { device_name: req.body?.device_name || req.headers['x-device-name'] || null, browser_info: userAgent || null, os_info: req.headers['x-os-info'] || null, ip_address: req.headers['x-forwarded-for'] || req.ip || null },
    businessIdentity: {
      store_number: req.body?.store_number || req.headers['x-store-number'] || null,
      pos_no: req.body?.pos_no || req.headers['x-pos-no'] || null,
      touchpoint_id: req.body?.touchpoint_id || req.headers['x-touchpoint-id'] || null,
    },
  };
};

module.exports = { resolveBranchDeviceLimit, fetchBranchPolicy, ensureDeviceRegistration, sanitizeDeviceContext };
