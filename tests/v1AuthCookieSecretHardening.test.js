const fs = require('fs');
const path = require('path');

const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'src/controllers/authController.js'), 'utf8');

const loadJwtUtils = () => {
  jest.resetModules();
  return require('../src/utils/jwt');
};

describe('V1 tenant auth cookie and secret hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('tenant signing authority fails closed with a clear error when JWT_SECRET is absent', () => {
    delete process.env.JWT_SECRET;
    const { signTenantToken, verifyTenantToken } = loadJwtUtils();
    expect(() => signTenantToken({ type: 'tenant', tenant_id: 'tenant-a', user_id: 'user-a' }))
      .toThrow('JWT_SECRET is required for tenant authentication');
    expect(() => verifyTenantToken('anything'))
      .toThrow('JWT_SECRET is required for tenant authentication');
  });

  test('tenant auth cookies are HttpOnly and production Secure with SameSite Lax', () => {
    process.env.JWT_SECRET = 'tenant-secret';
    process.env.NODE_ENV = 'production';
    const { setAuthCookie, clearAuthCookie } = loadJwtUtils();
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };

    setAuthCookie(res, 'secret-token', 'token', 900000);
    expect(res.cookie).toHaveBeenCalledWith('token', 'secret-token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 900000,
    });

    clearAuthCookie(res, 'token');
    expect(res.clearCookie).toHaveBeenCalledWith('token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
  });

  test('login and refresh keep access JWTs in cookies rather than JSON response payloads', () => {
    expect(controllerSource).toContain('setAccessAuthCookies(res, accessToken);');
    expect(controllerSource).toContain('setRefreshAuthCookie(res, refresh.rawToken, rememberMe);');
    expect(controllerSource).toContain('setRefreshAuthCookie(res, rotated.rawRefreshToken, rotated.rememberMe);');
    expect(controllerSource).not.toContain('\n    token,\n');
    // A bare `token: accessToken` JSON field is still forbidden; the mobile-only
    // `access_token` field is covered by the web-session scope check below.
    expect(controllerSource).not.toMatch(/(^|[^_])token: accessToken/m);
    expect(controllerSource).toContain('Access and refresh tokens are');
    expect(controllerSource).toContain('never returned in JSON');
    // Bearer tokens in JSON are confined to the explicit native-mobile session path.
    const webSession = controllerSource.slice(
      controllerSource.indexOf('const issueAuthSession = async'),
      controllerSource.indexOf('const issueMobileAuthSession = async')
    );
    expect(webSession).not.toContain('access_token');
    expect(webSession).not.toContain('refresh_token');
  });
});
