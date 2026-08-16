const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getPermissionsForRole, ROLE_PERMISSIONS } = require('../utils/rolePermissions');
const { jsonError } = require('../utils/responses');
const { normalizePrivateKeyPem } = require('../utils/pem');
const { resolveDevice } = require('../configuration/targets');

const getOfflineGrantPrivateKey = () => normalizePrivateKeyPem(process.env.POS_OFFLINE_GRANT_PRIVATE_KEY);

const normalizeClaimId = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
};

const loadCurrentUserAuthority = async (tenantPool, userId) => {
  const result = await tenantPool.query(
    `SELECT id, role, branch_id, all_branch_access
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const role = String(row.role || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return null;
  return {
    userId: normalizeClaimId(row.id),
    role,
    branchId: normalizeClaimId(row.branch_id),
    allBranchAccess: row.all_branch_access === true,
    permissions: getPermissionsForRole(role),
  };
};

const issueOfflineGrant = async (req, res) => {
  try {
    if (!req.user) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Not authenticated');
    }

    const privateKey = getOfflineGrantPrivateKey();
    if (!privateKey) {
      return jsonError(res, 503, 'OFFLINE_GRANT_DISABLED', 'Offline POS grants are not configured');
    }

    const deviceId = String(req.body?.device_id || '').trim();
    if (!deviceId) {
      return jsonError(res, 400, 'POS_DEVICE_REQUIRED', 'device_id is required for offline POS authorization');
    }
    if (!req.tenantPool) {
      return jsonError(res, 500, 'TENANT_POOL_MISSING', 'Tenant database context is unavailable');
    }

    const userId = normalizeClaimId(req.user.user_id || req.user.id);
    const tenantId = normalizeClaimId(req.user.tenant_id);
    if (!userId || !tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Authenticated user context is incomplete');
    }

    // Offline grants can outlive the short interactive access token. Reload the
    // user authority from Central immediately before signing so a stale JWT
    // cannot turn a role/branch downgrade into a fresh long-lived offline grant.
    const currentUser = await loadCurrentUserAuthority(req.tenantPool, userId);
    if (!currentUser) {
      return jsonError(res, 403, 'OFFLINE_GRANT_USER_FORBIDDEN', 'Current Central user authority is unavailable');
    }

    const device = await resolveDevice(req.tenantPool, deviceId, { requireActive: true });
    if (!device?.active || !device.branchId) {
      return jsonError(res, 403, 'POS_DEVICE_NOT_REGISTERED', 'An active Central POS device registration is required');
    }

    const trustedBranchId = normalizeClaimId(device.branchId);
    if (!currentUser.allBranchAccess && (!currentUser.branchId || currentUser.branchId !== trustedBranchId)) {
      return jsonError(res, 403, 'POS_DEVICE_BRANCH_FORBIDDEN', 'POS device is outside the user branch scope');
    }

    const storePermissions = {
      branch_id: trustedBranchId,
      all_branch_access: false,
    };
    const grant = jwt.sign(
      {
        type: 'pos_offline_grant',
        user_id: currentUser.userId,
        tenant_id: tenantId,
        role: currentUser.role,
        device_id: device.deviceId,
        branch_id: trustedBranchId,
        all_branch_access: false,
        permissions: currentUser.permissions,
        store_permissions: storePermissions,
        grant_id: crypto.randomUUID(),
      },
      privateKey,
      {
        algorithm: 'RS256',
        expiresIn: process.env.POS_OFFLINE_GRANT_EXPIRY || '7d',
        issuer: 'shajtech-central',
        audience: 'shajtech-pos-edge',
        keyid: process.env.POS_OFFLINE_GRANT_KEY_ID || 'pos-offline-v1',
      }
    );

    return res.status(200).json({
      success: true,
      offline_grant: grant,
      user_id: currentUser.userId,
      device_id: device.deviceId,
      branch_id: trustedBranchId,
      expires_in: process.env.POS_OFFLINE_GRANT_EXPIRY || '7d',
    });
  } catch (error) {
    return jsonError(res, 500, 'OFFLINE_GRANT_FAILED', error.message);
  }
};

module.exports = { issueOfflineGrant, loadCurrentUserAuthority };
