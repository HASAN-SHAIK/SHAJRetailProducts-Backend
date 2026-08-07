const crypto = require('crypto');
const { resolveTenantContext } = require('../config/tenantDbResolver');

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const posSyncAuth = async (req, res, next) => {
  const expected = process.env.POS_SYNC_SHARED_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'POS_SYNC_NOT_CONFIGURED' });
  }

  const token = req.headers['x-pos-sync-token'];
  const tenantId = String(req.headers['x-pos-tenant-id'] || '').trim();
  const deviceId = String(req.headers['x-pos-device-id'] || '').trim();
  if (!safeEqual(token, expected)) {
    return res.status(401).json({ error: 'POS_SYNC_UNAUTHORIZED' });
  }
  if (!tenantId || !deviceId) {
    return res.status(400).json({ error: 'POS_SYNC_CONTEXT_REQUIRED' });
  }

  try {
    const context = await resolveTenantContext(tenantId);
    if (!context || context.tenant?.is_active === false) {
      return res.status(403).json({ error: 'TENANT_DISABLED' });
    }
    req.tenant_id = tenantId;
    req.tenant = context.tenant;
    req.tenantPool = context.tenantPool;
    req.posDeviceId = deviceId;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'POS_SYNC_TENANT_INVALID' });
  }
};

module.exports = { posSyncAuth };
