const { jsonError } = require('../utils/responses');
const { resolveTenantContext } = require('../config/tenantDbResolver');

const tenantResolver = async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');

    const context = await resolveTenantContext(tenantId);
    if (!context || context.tenant?.is_active === false) {
      return jsonError(res, 403, 'TENANT_DISABLED', 'Tenant is disabled');
    }

    req.tenant = context.tenant;
    req.tenantPool = context.tenantPool;
    req.planFeatures = context.planFeatures || {};
    return next();
  } catch (error) {
    return jsonError(res, 500, 'TENANT_RESOLVE_FAILED', 'Failed to resolve tenant');
  }
};

module.exports = { tenantResolver };
