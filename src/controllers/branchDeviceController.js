const { jsonError, jsonOk } = require('../utils/responses');
const {
  resolveBranchDeviceLimit,
  fetchBranchPolicy,
  ensureDeviceRegistration,
  sanitizeDeviceContext
} = require('../utils/branchDeviceLicensing');
const { normalizePlan } = require('../config/planDeviceLimits');

const getBranchDevices = async (req, res) => {
  try {
    const branchId = req.params.branchId;
    if (!branchId) return jsonError(res, 400, 'VALIDATION_ERROR', 'branch_id is required');
    const branch = await fetchBranchPolicy(req.tenantPool, branchId);
    if (!branch) return jsonError(res, 404, 'BRANCH_NOT_FOUND', 'Branch not found');

    const devicesRes = await req.tenantPool.query(
      `SELECT id, device_id, device_name, store_number, pos_no, touchpoint_id,
              browser_info, os_info, ip_address, last_login_at, is_active, created_at
       FROM branch_devices
       WHERE branch_id = $1
       ORDER BY is_active DESC, last_login_at DESC NULLS LAST, created_at DESC`,
      [branchId]
    );
    const activeCountRes = await req.tenantPool.query(
      `SELECT COUNT(*)::int AS count FROM branch_devices WHERE branch_id = $1 AND is_active = TRUE`,
      [branchId]
    );
    const limit = resolveBranchDeviceLimit(branch);
    return jsonOk(res, {
      branch: {
        id: branch.id,
        store_number: branch.store_number,
        subscription_plan: branch.subscription_plan,
        max_devices_allowed: branch.max_devices_allowed,
        resolved_limit: limit
      },
      devices: devicesRes.rows,
      active_count: activeCountRes.rows[0]?.count || 0
    }, 'Devices fetched');
  } catch (error) {
    return jsonError(res, 500, 'DEVICE_FETCH_FAILED', error.message);
  }
};

const deactivateBranchDevice = async (req, res) => {
  try {
    const branchId = req.params.branchId;
    const deviceId = req.params.deviceId;
    if (!branchId || !deviceId) return jsonError(res, 400, 'VALIDATION_ERROR', 'branch_id and device_id are required');
    const deviceRes = await req.tenantPool.query(
      `UPDATE branch_devices SET is_active = FALSE WHERE id = $1 AND branch_id = $2 RETURNING id, device_id, is_active`,
      [deviceId, branchId]
    );
    if (!deviceRes.rowCount) return jsonError(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
    await req.tenantPool.query(
      `INSERT INTO branch_device_logs (branch_id, user_id, device_id, action, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [branchId, req.user?.user_id || req.user?.id || null, deviceRes.rows[0]?.device_id || null, 'DEVICE_DEACTIVATED', JSON.stringify({ by: req.user?.user_id || req.user?.id || null })]
    );
    return jsonOk(res, { success: true }, 'Device deactivated');
  } catch (error) {
    return jsonError(res, 500, 'DEVICE_DEACTIVATE_FAILED', error.message);
  }
};

const updateBranchPlan = async (req, res) => {
  try {
    const branchId = req.params.branchId;
    if (!branchId) return jsonError(res, 400, 'VALIDATION_ERROR', 'branch_id is required');
    const { subscription_plan, max_devices_allowed } = req.body || {};
    const plan = subscription_plan ? normalizePlan(subscription_plan) : null;
    const maxAllowed = max_devices_allowed === null || max_devices_allowed === undefined ? null : Number(max_devices_allowed);
    if (!plan) return jsonError(res, 400, 'VALIDATION_ERROR', 'subscription_plan is required');
    await req.tenantPool.query(
      `UPDATE branches SET subscription_plan = $1, max_devices_allowed = $2 WHERE id = $3`,
      [plan, Number.isFinite(maxAllowed) ? maxAllowed : null, branchId]
    );
    await req.tenantPool.query(
      `INSERT INTO branch_device_logs (branch_id, user_id, device_id, action, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [branchId, req.user?.user_id || req.user?.id || null, null, 'BRANCH_PLAN_UPDATED', JSON.stringify({ subscription_plan: plan, max_devices_allowed: maxAllowed })]
    );
    return jsonOk(res, { success: true }, 'Branch plan updated');
  } catch (error) {
    return jsonError(res, 500, 'BRANCH_PLAN_UPDATE_FAILED', error.message);
  }
};

const registerDeviceOnBranch = async (req, res) => {
  try {
    const branchId = req.params.branchId;
    if (!branchId) return jsonError(res, 400, 'VALIDATION_ERROR', 'branch_id is required');

    const { deviceId, deviceInfo, businessIdentity } = sanitizeDeviceContext(req);
    if (!deviceId) return jsonError(res, 400, 'VALIDATION_ERROR', 'device_id is required');
    if (!businessIdentity.store_number || !businessIdentity.pos_no || !businessIdentity.touchpoint_id) {
      return jsonError(res, 400, 'POS_BUSINESS_IDENTITY_REQUIRED', 'store_number, pos_no and touchpoint_id are required');
    }

    const result = await ensureDeviceRegistration({
      tenantPool: req.tenantPool,
      branchId,
      deviceId,
      userId: req.user?.user_id || req.user?.id,
      mode: 'register',
      deviceInfo,
      businessIdentity
    });

    if (!result.allowed) {
      if (result.code === 'DEVICE_LIMIT_REACHED') {
        return jsonError(res, 403, 'DEVICE_LIMIT_REACHED', 'Device limit reached for this branch. Please remove an existing device or upgrade your plan.');
      }
      if (result.code === 'POS_IDENTITY_IN_USE') {
        return jsonError(res, 409, 'POS_IDENTITY_IN_USE', 'Store/POS/Touchpoint is already assigned to another active device.');
      }
      if (result.code === 'STORE_NUMBER_MISMATCH') {
        return jsonError(res, 409, 'STORE_NUMBER_MISMATCH', 'Store number does not match the selected branch.');
      }
      return jsonError(res, 403, result.code || 'DEVICE_NOT_ALLOWED', 'Access denied from this device');
    }

    return jsonOk(res, {
      success: true,
      limit: result.limit,
      store_number: result.storeNumber,
      pos_no: result.posNo,
      touchpoint_id: result.touchpointId
    }, 'Device registered');
  } catch (error) {
    return jsonError(res, 500, 'DEVICE_REGISTER_FAILED', error.message);
  }
};

module.exports = { getBranchDevices, deactivateBranchDevice, updateBranchPlan, registerDeviceOnBranch };
