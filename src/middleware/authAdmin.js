const { jsonError } = require('../utils/responses');
const {
  DEFAULT_ADMIN_COOKIE,
  getTokenFromRequest,
  verifyAdminToken
} = require('../utils/jwt');

const authAdminMiddleware = (req, res, next) => {
  const token = getTokenFromRequest(req, DEFAULT_ADMIN_COOKIE);
  if (!token) return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');

  try {
    const verified = verifyAdminToken(token);
    if (verified?.type !== 'admin' || !verified?.admin_id) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid token payload');
    }
    if (verified.role !== 'platform_admin') {
      return jsonError(res, 403, 'FORBIDDEN', 'Invalid admin role');
    }

    req.admin = verified;
    return next();
  } catch (error) {
    return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid token');
  }
};

module.exports = { authAdminMiddleware };
