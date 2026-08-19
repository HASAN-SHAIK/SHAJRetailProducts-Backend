const rateLimit = require('express-rate-limit');

const AUTH_RATE_LIMITS = Object.freeze({
  loginWindowMs: 10 * 60 * 1000,
  loginMaxFailures: 10,
  refreshWindowMs: 10 * 60 * 1000,
  refreshMax: 120,
});

const rateLimitResponse = (message) => ({
  success: false,
  code: 'RATE_LIMITED',
  message,
});

const createTenantLoginLimiter = () =>
  rateLimit({
    windowMs: AUTH_RATE_LIMITS.loginWindowMs,
    max: AUTH_RATE_LIMITS.loginMaxFailures,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: rateLimitResponse('Too many failed login attempts. Please try again later.'),
  });

const createTenantRefreshLimiter = () =>
  rateLimit({
    windowMs: AUTH_RATE_LIMITS.refreshWindowMs,
    max: AUTH_RATE_LIMITS.refreshMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitResponse('Too many session refresh attempts. Please try again later.'),
  });

// Share these limiter instances across the legacy and /api/v1 auth aliases so
// callers cannot double their allowance by alternating between route versions.
const tenantLoginLimiter = createTenantLoginLimiter();
const tenantRefreshLimiter = createTenantRefreshLimiter();

module.exports = {
  AUTH_RATE_LIMITS,
  createTenantLoginLimiter,
  createTenantRefreshLimiter,
  tenantLoginLimiter,
  tenantRefreshLimiter,
};
