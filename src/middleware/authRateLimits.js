const rateLimit = require('express-rate-limit');

const rateLimitResponse = (message) => ({
  success: false,
  code: 'RATE_LIMITED',
  message,
});

// Share these limiter instances across the legacy and /api/v1 auth aliases so
// callers cannot double their allowance by alternating between route versions.
const tenantLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: rateLimitResponse('Too many failed login attempts. Please try again later.'),
});

const tenantRefreshLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse('Too many session refresh attempts. Please try again later.'),
});

module.exports = {
  tenantLoginLimiter,
  tenantRefreshLimiter,
};
