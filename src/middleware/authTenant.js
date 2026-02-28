const { jsonError } = require('../utils/responses');
const {
  DEFAULT_TENANT_COOKIE,
  getTokenFromRequest,
  verifyTenantToken
} = require('../utils/jwt');
const { resolveTenantContext } = require('../config/tenantDbResolver');

const authTenantMiddleware = async (req, res, next) => {
  const token = getTokenFromRequest(req, DEFAULT_TENANT_COOKIE);
  if (!token) return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');

  try {
    const verified = verifyTenantToken(token);
    if (verified?.type !== 'tenant' || !verified?.tenant_id || !verified?.user_id) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid token payload');
    }
    if (verified.role !== 'admin' && verified.role !== 'staff') {
      return jsonError(res, 403, 'FORBIDDEN', 'Invalid tenant role');
    }

    req.user = verified;
    req.tenant_id = verified.tenant_id;

    const context = await resolveTenantContext(verified.tenant_id);
    if (!context || context.tenant?.is_active === false) {
      return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
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
