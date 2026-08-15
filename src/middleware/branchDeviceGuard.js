const { jsonError } = require('../utils/responses');
const { ensureDeviceRegistration, sanitizeDeviceContext } = require('../utils/branchDeviceLicensing');

const shouldSkipBranchDeviceCheck = (req) => {
  if (!req?.user || req.user?.type !== 'tenant') return true;
  const branchHeader = req.headers['x-branch-id'];
  if (!branchHeader || branchHeader === 'all') return true;
  return false;
};

const branchDeviceGuard = async (req, res, next) => {
  try {
    if (shouldSkipBranchDeviceCheck(req)) return next();
    const branchId = req.headers['x-branch-id'];
    if (!branchId) return next();

    const { deviceId, deviceInfo } = sanitizeDeviceContext(req);
    if (!deviceId) {
      return jsonError(res, 403, 'DEVICE_NOT_RECOGNIZED', 'Device not recognized');
    }

    // Ordinary authenticated tenant requests must never create or reactivate
    // POS device registrations. First-run registration/licensing remains an
    // explicit Central-controlled workflow.
    const result = await ensureDeviceRegistration({
      tenantPool: req.tenantPool,
      branchId,
      deviceId,
      userId: req.user?.user_id || req.user?.id,
      mode: 'validate',
      deviceInfo
    });

    if (!result.allowed) {
      if (result.code === 'DEVICE_LIMIT_REACHED') {
        return jsonError(
          res,
          403,
          'DEVICE_LIMIT_REACHED',
          'Device limit reached for this branch. Please remove an existing device or upgrade your plan.'
        );
      }
      return jsonError(res, 403, 'DEVICE_NOT_ALLOWED', 'Access denied from this device');
    }

    return next();
  } catch (error) {
    return jsonError(res, 500, 'DEVICE_CHECK_FAILED', 'Failed to validate device');
  }
};

module.exports = { branchDeviceGuard };
