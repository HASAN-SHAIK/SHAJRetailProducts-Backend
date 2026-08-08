const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getPermissionsForRole, getStorePermissions } = require('../utils/rolePermissions');
const { jsonError } = require('../utils/responses');

const normalizePem = (value) => String(value || '').trim().replace(/\\n/g, '\n');
const getOfflineGrantPrivateKey = () => normalizePem(process.env.POS_OFFLINE_GRANT_PRIVATE_KEY);

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

    const userId = req.user.user_id || req.user.id;
    const tenantId = req.user.tenant_id;
    const role = String(req.user.role || '').toLowerCase();
    if (!userId || !tenantId || !role) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Authenticated user context is incomplete');
    }

    const permissions = req.user.permissions || getPermissionsForRole(role);
    const storePermissions = req.user.store_permissions || getStorePermissions(req.user);
    const grant = jwt.sign(
      {
        type: 'pos_offline_grant',
        user_id: userId,
        tenant_id: tenantId,
        role,
        device_id: deviceId,
        branch_id: req.user.branch_id || null,
        all_branch_access: req.user.all_branch_access !== false,
        permissions,
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
      user_id: userId,
      device_id: deviceId,
      expires_in: process.env.POS_OFFLINE_GRANT_EXPIRY || '7d',
    });
  } catch (error) {
    return jsonError(res, 500, 'OFFLINE_GRANT_FAILED', error.message);
  }
};

module.exports = { issueOfflineGrant };
