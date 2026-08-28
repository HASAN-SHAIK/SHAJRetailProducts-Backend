const { sendError } = require('../dto/apiResponse');

const authorizeRoles = (...roles) => (req, res, next) => {
  const role = req.user?.role;
  if (!role) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
  }
  if (!roles.includes(role)) {
    return sendError(res, 403, 'FORBIDDEN', 'Insufficient permissions');
  }
  return next();
};

const requireAdmin = authorizeRoles('admin');
const requireTenantUser = authorizeRoles('admin', 'manager', 'staff');

module.exports = {
  authorizeRoles,
  requireAdmin,
  requireTenantUser,
};
