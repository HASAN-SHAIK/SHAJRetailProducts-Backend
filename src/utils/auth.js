const {
  DEFAULT_TENANT_COOKIE,
  getTokenFromRequest,
  verifyTenantToken
} = require('./jwt');

const getAuthUser = (req) => {
  if (req?.user) return req.user;
  const token = getTokenFromRequest(req, DEFAULT_TENANT_COOKIE);
  if (!token) return null;
  try {
    const decoded = verifyTenantToken(token);
    if (decoded?.type !== 'tenant') return null;
    return decoded;
  } catch (err) {
    return null;
  }
};

module.exports = { getAuthUser, getTokenFromRequest };
