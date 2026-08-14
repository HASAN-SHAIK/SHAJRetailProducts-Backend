const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { hasPermission } = require('../utils/rolePermissions');
const { jsonError } = require('../utils/responses');
const { normalizePrivateKeyPem } = require('../utils/pem');

const getSigningKey = () => normalizePrivateKeyPem(process.env.POS_OFFLINE_GRANT_PRIVATE_KEY);

const issuePosSyncRecoveryGrant = async (req, res) => {
  try {
    if (!req.user) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Not authenticated');
    }
    if (!hasPermission(req.user, 'pos:approve')) {
      return jsonError(res, 403, 'POS_SYNC_RECOVERY_FORBIDDEN', 'POS sync recovery requires manager approval');
    }

    const privateKey = getSigningKey();
    if (!privateKey) {
      return jsonError(res, 503, 'POS_SYNC_RECOVERY_DISABLED', 'POS sync recovery grants are not configured');
    }

    const deviceId = String(req.body?.device_id || '').trim();
    const orderId = String(req.body?.order_id || '').trim();
    const eventId = String(req.body?.event_id || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!deviceId || !orderId || !eventId || !reason) {
      return jsonError(
        res,
        400,
        'POS_SYNC_RECOVERY_CONTEXT_REQUIRED',
        'device_id, order_id, event_id, and reason are required'
      );
    }

    const userId = req.user.user_id || req.user.id;
    const tenantId = req.user.tenant_id;
    if (!userId || !tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Authenticated user context is incomplete');
    }

    const recoveryId = crypto.randomUUID();
    const expiresIn = process.env.POS_SYNC_RECOVERY_GRANT_EXPIRY || '10m';
    const recoveryGrant = jwt.sign(
      {
        type: 'pos_sync_recovery_grant',
        recovery_id: recoveryId,
        tenant_id: tenantId,
        device_id: deviceId,
        order_id: orderId,
        ordering_key: `sales_order:${orderId}`,
        event_id: eventId,
        approved_by_user_id: userId,
        reason,
      },
      privateKey,
      {
        algorithm: 'RS256',
        expiresIn,
        issuer: 'shajtech-central',
        audience: 'shajtech-pos-edge',
        keyid: process.env.POS_OFFLINE_GRANT_KEY_ID || 'pos-offline-v1',
      }
    );

    return res.status(200).json({
      success: true,
      recovery_grant: recoveryGrant,
      recovery_id: recoveryId,
      device_id: deviceId,
      order_id: orderId,
      event_id: eventId,
      expires_in: expiresIn,
    });
  } catch (error) {
    return jsonError(res, 500, 'POS_SYNC_RECOVERY_GRANT_FAILED', error.message);
  }
};

module.exports = { issuePosSyncRecoveryGrant };
