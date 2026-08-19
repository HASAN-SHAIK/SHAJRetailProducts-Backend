const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const {
  AUTH_RATE_LIMITS,
  createTenantLoginLimiter,
} = require('../src/middleware/authRateLimits');

const buildApp = ({ status = 401 } = {}) => {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/login', createTenantLoginLimiter(), (req, res) => {
    res.status(status).json({ success: status < 400 });
  });
  return app;
};

describe('V1 auth-sensitive rate limiting', () => {
  test('failed tenant logins are bounded and return a stable 429 contract', async () => {
    const app = buildApp({ status: 401 });

    for (let attempt = 0; attempt < AUTH_RATE_LIMITS.loginMaxFailures; attempt += 1) {
      await request(app).post('/login').expect(401);
    }

    const blocked = await request(app).post('/login').expect(429);
    expect(blocked.body).toEqual({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many failed login attempts. Please try again later.',
    });
  });

  test('successful login requests do not consume the failed-login allowance', async () => {
    const app = buildApp({ status: 200 });

    for (let attempt = 0; attempt < AUTH_RATE_LIMITS.loginMaxFailures + 2; attempt += 1) {
      await request(app).post('/login').expect(200);
    }
  });

  test('legacy and V1 tenant auth aliases share login and refresh limiter instances', () => {
    const legacy = fs.readFileSync(path.join(__dirname, '../src/routes/authRoutes.js'), 'utf8');
    const v1 = fs.readFileSync(path.join(__dirname, '../src/api/v1/modules/auth/auth.routes.js'), 'utf8');

    expect(legacy).toContain("require('../middleware/authRateLimits')");
    expect(legacy).toContain("router.post('/login', tenantLoginLimiter, login)");
    expect(legacy).toContain("router.post('/refresh', tenantRefreshLimiter, refresh)");

    expect(v1).toContain("require('../../../../middleware/authRateLimits')");
    expect(v1).toContain("router.post('/login', tenantLoginLimiter, validateRequest(loginSchema), wrapLegacy(login))");
    expect(v1).toContain("router.post('/refresh', tenantRefreshLimiter, wrapLegacy(refresh))");

    expect(AUTH_RATE_LIMITS.refreshMax).toBe(120);
    expect(AUTH_RATE_LIMITS.refreshWindowMs).toBe(10 * 60 * 1000);
  });
});
