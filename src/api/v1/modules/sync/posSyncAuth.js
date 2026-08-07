const crypto = require('crypto');
const { resolveTenantContext } = require('../../../../config/tenantDbResolver');

const safeEqual = (provided, expected) => {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
};

const configuredTokenForTenant = (tenantId) => {
  const raw = process.env.POS_SYNC_TOKENS_JSON;
  if (raw) {
    try {
      const tokens = JSON.parse(raw);
      if (tokens && typeof tokens === 'object' && typeof tokens[tenantId] === 'string') {
        return tokens[tenantId];
      }
    } catch (error) {
      throw new Error('POS_SYNC_TOKENS_JSON must be valid JSON');
    }
  }

  const fallbackToken = process.env.POS_SYNC_TOKEN;
  const fallbackTenant = process.env.POS_SYNC_TENANT_ID;
  if (fallbackToken && fallbackTenant && String(fallbackTenant) === String(tenantId)) {
    return fallbackToken;
  }
  return null;
};

const posSyncAuth = async (req, res, next) => {
  const tenantId = String(req.get('X-POS-Tenant-ID') || '').trim();
  const deviceId = String(req.get('X-POS-Device-ID') || '').trim();
  const providedToken = String(req.get('X-POS-Sync-Token') || '').trim();

  if (!tenantId || !deviceId || !providedToken) {
    return res.status(401).json({ code: 'POS_SYNC_UNAUTHORIZED', message: 'Missing POS sync credentials' });
  }

  let expectedToken;
  try {
    expectedToken = configuredTokenForTenant(tenantId);
  } catch (error) {
    return next(error);
  }

  if (!expectedToken || !safeEqual(providedToken, expectedToken)) {
    return res.status(401).json({ code: 'POS_SYNC_UNAUTHORIZED', message: 'Invalid POS sync credentials' });
  }

  const context = await resolveTenantContext(tenantId);
  if (!context || context.tenant?.is_active === false) {
    return res.status(403).json({ code: 'POS_SYNC_TENANT_DISABLED', message: 'Tenant is unavailable' });
  }

  req.tenant_id = tenantId;
  req.tenant = context.tenant;
  req.tenantPool = context.tenantPool;
  req.planFeatures = context.planFeatures || {};
  req.posDeviceId = deviceId;
  return next();
};

module.exports = { posSyncAuth, safeEqual, configuredTokenForTenant };
