const jwt = require('jsonwebtoken');

const DEFAULT_TENANT_COOKIE = 'token';
const DEFAULT_ADMIN_COOKIE = 'admin_token';

const getTokenFromRequest = (req, cookieName) => {
  const cookieToken = cookieName ? req.cookies?.[cookieName] : null;
  const headerToken = req.headers.authorization
    ? req.headers.authorization.replace(/^Bearer\s+/i, '')
    : null;
  return cookieToken || headerToken || null;
};

const getTenantJwtSecret = () => process.env.JWT_SECRET;
const getAdminJwtSecret = () => process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

const signTenantToken = (payload, options = {}) => {
  return jwt.sign(payload, getTenantJwtSecret(), {
    expiresIn: process.env.TOKEN_EXPIRY ? Number(process.env.TOKEN_EXPIRY) : '8h',
    ...options
  });
};

const signAdminToken = (payload, options = {}) => {
  return jwt.sign(payload, getAdminJwtSecret(), {
    expiresIn: process.env.ADMIN_TOKEN_EXPIRY ? Number(process.env.ADMIN_TOKEN_EXPIRY) : '4h',
    ...options
  });
};

const verifyTenantToken = (token) => {
  return jwt.verify(token, getTenantJwtSecret());
};

const verifyAdminToken = (token) => {
  return jwt.verify(token, getAdminJwtSecret());
};

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
});

const setAuthCookie = (res, token, cookieName, maxAgeMs) => {
  const options = getCookieOptions();
  if (maxAgeMs) options.maxAge = maxAgeMs;
  res.cookie(cookieName, token, options);
};

const clearAuthCookie = (res, cookieName) => {
  res.clearCookie(cookieName, getCookieOptions());
};

module.exports = {
  DEFAULT_TENANT_COOKIE,
  DEFAULT_ADMIN_COOKIE,
  getTokenFromRequest,
  signTenantToken,
  signAdminToken,
  verifyTenantToken,
  verifyAdminToken,
  setAuthCookie,
  clearAuthCookie
};
