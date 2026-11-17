const { jsonError } = require('../utils/responses');
const {
  DEFAULT_TENANT_COOKIE,
  getTokenFromRequest,
  verifyTenantToken
} = require('../utils/jwt');
const { ROLE_PERMISSIONS } = require('../utils/rolePermissions');
const { resolveTenantContext } = require('../config/tenantDbResolver');

const authTenantMiddleware = async (req, res, next) => {
  const token = getTokenFromRequest(req, DEFAULT_TENANT_COOKIE);
  if (!token) {
    console.warn(`[Auth] Tenant auth missing token for: ${req.method} ${req.originalUrl}`);
    return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  }

  try {
    const verified = verifyTenantToken(token);
    if (verified?.type !== 'tenant' || !verified?.tenant_id || !verified?.user_id) {
      console.warn(`[Auth] Invalid tenant token payload for: ${req.method} ${req.originalUrl}`, verified);
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid token payload');
    }

    const normalizedRole = String(verified.role || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, normalizedRole)) {
      console.warn(`[Auth] Invalid tenant role '${verified.role}' for: ${req.method} ${req.originalUrl}`);
      return jsonError(res, 403, 'FORBIDDEN', 'Invalid tenant role');
    }
    verified.role = normalizedRole;

    req.user = verified;
    req.tenant_id = verified.tenant_id;

    // Central tenant state is authoritative. Platform tenant mutations clear the
    // tenant runtime cache, so a stale JWT tenant_active claim cannot keep a
    // disabled tenant authorized until access-token expiry.
    const context = await resolveTenantContext(verified.tenant_id);
    if (!context || context.tenant?.is_active === false) {
      console.warn(`[Auth] Tenant ${verified.tenant_id} is disabled or not found for: ${req.method} ${req.originalUrl}`);
      return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    }

    req.tenant = context.tenant;
    req.tenantPool = context.tenantPool;
    req.planFeatures = context.planFeatures || {};
    return next();
  } catch (error) {
    console.error(`[Auth] Tenant auth verification failed for ${req.method} ${req.originalUrl}:`, error?.stack || error?.message || error);
    return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid token');
  }
};

module.exports = { authTenantMiddleware };
