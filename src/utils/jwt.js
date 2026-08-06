const jwt = require('jsonwebtoken');

const DEFAULT_TENANT_COOKIE = 'token';
const DEFAULT_TENANT_REFRESH_COOKIE = 'refresh_token';
const DEFAULT_ADMIN_COOKIE = 'admin_token';

const normalizeTokenValue = (value) => {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned) return null;
  const lowered = cleaned.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined' || lowered === 'nan') return null;
  return cleaned;
};

const getTokenFromRequest = (req, cookieName) => {
  const authHeader = req?.headers?.authorization;
  const headerToken = authHeader ? normalizeTokenValue(authHeader.replace(/^Bearer\s+/i, '')) : null;
  const cookieToken = cookieName ? normalizeTokenValue(req?.cookies?.[cookieName]) : null;
  return headerToken || cookieToken || null;
};

const getTenantJwtSecret = () => process.env.JWT_SECRET;
const getAdminJwtSecret = () => process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

const signTenantToken = (payload, options = {}) => {
  return jwt.sign(payload, getTenantJwtSecret(), {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY || process.env.TOKEN_EXPIRY || '15m',
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
  DEFAULT_TENANT_REFRESH_COOKIE,
  DEFAULT_ADMIN_COOKIE,
  getTokenFromRequest,
  signTenantToken,
  signAdminToken,
  verifyTenantToken,
  verifyAdminToken,
  setAuthCookie,
  clearAuthCookie
};
