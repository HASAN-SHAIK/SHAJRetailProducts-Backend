const { jsonError } = require('../utils/responses');
const {
  DEFAULT_TENANT_COOKIE,
  getTokenFromRequest,
  verifyTenantToken
} = require('../utils/jwt');
const { ROLE_PERMISSIONS } = require('../utils/rolePermissions');
const { resolveTenantContext, resolveTenantContextFromToken } = require('../config/tenantDbResolver');

const authTenantMiddleware = async (req, res, next) => {
  const token = getTokenFromRequest(req, DEFAULT_TENANT_COOKIE);
  if (!token) return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');

  try {
    const verified = verifyTenantToken(token);
    if (verified?.type !== 'tenant' || !verified?.tenant_id || !verified?.user_id) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid token payload');
    }

    const normalizedRole = String(verified.role || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, normalizedRole)) {
      return jsonError(res, 403, 'FORBIDDEN', 'Invalid tenant role');
    }
    verified.role = normalizedRole;

    req.user = verified;
    req.tenant_id = verified.tenant_id;

    let context = resolveTenantContextFromToken(verified);
    if (context?.tenant?.is_active === false) {
      return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    }
    if (!context) {
      context = await resolveTenantContext(verified.tenant_id);
      if (!context || context.tenant?.is_active === false) {
        return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
      }
    }

    req.tenant = context.tenant;
    req.tenantPool = context.tenantPool;
    req.planFeatures = context.planFeatures || {};
    return next();
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid token');
  }
};

module.exports = { authTenantMiddleware };
