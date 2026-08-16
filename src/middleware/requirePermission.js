const { jsonError } = require('../utils/responses');
const { hasPermission } = require('../utils/rolePermissions');

const requirePermission = (permission) => {
  if (!permission) throw new Error('permission is required');

  return (req, res, next) => {
    const user = req.user;
    if (!user || user.type !== 'tenant') {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
    }
    if (!hasPermission(user, permission)) {
      return jsonError(res, 403, 'FORBIDDEN', `Missing required permission: ${permission}`);
    }
    return next();
  };
};

module.exports = { requirePermission };
