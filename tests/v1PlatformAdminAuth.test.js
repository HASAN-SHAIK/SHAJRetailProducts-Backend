const {
  DEFAULT_ADMIN_COOKIE,
  signTenantToken,
  signAdminToken,
  verifyTenantToken,
  verifyAdminToken,
} = require('../src/utils/jwt');
const { authAdminMiddleware } = require('../src/middleware/authAdmin');

const responseMock = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('V1 platform-admin authentication isolation', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'tenant-secret-v1-which-is-different';
    process.env.ADMIN_JWT_SECRET = 'admin-secret-v1-which-is-different';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_JWT_SECRET;
  });

  test('tenant-signed token cannot cross into platform-admin verification even with forged admin claims', () => {
    const tenantSigned = signTenantToken({
      type: 'admin',
      admin_id: '1',
      role: 'platform_admin',
    });
    expect(() => verifyAdminToken(tenantSigned)).toThrow();
  });

  test('platform-admin token cannot cross into tenant verification', () => {
    const adminSigned = signAdminToken({
      type: 'tenant',
      tenant_id: 'tenant-1',
      user_id: '44',
      role: 'admin',
    });
    expect(() => verifyTenantToken(adminSigned)).toThrow();
  });

  test('dedicated platform-admin secret is mandatory and never falls back to tenant secret', () => {
    const validAdminToken = signAdminToken({
      type: 'admin',
      admin_id: '1',
      role: 'platform_admin',
    });
    delete process.env.ADMIN_JWT_SECRET;

    expect(() => signAdminToken({ type: 'admin', admin_id: '2', role: 'platform_admin' }))
      .toThrow('ADMIN_JWT_SECRET is required');
    expect(() => verifyAdminToken(validAdminToken)).toThrow('ADMIN_JWT_SECRET is required');
  });

  test.each(['platform_admin', 'super_admin'])('middleware accepts supported %s role only with admin-signed token', (role) => {
    const token = signAdminToken({ type: 'admin', admin_id: '1', role });
    const req = { headers: {}, cookies: { [DEFAULT_ADMIN_COOKIE]: token } };
    const res = responseMock();
    const next = jest.fn();

    authAdminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin).toMatchObject({ admin_id: '1', role });
  });

  test('middleware rejects tenant-signed token on the platform-admin route boundary', () => {
    const token = signTenantToken({ type: 'admin', admin_id: '1', role: 'platform_admin' });
    const req = { headers: {}, cookies: { [DEFAULT_ADMIN_COOKIE]: token } };
    const res = responseMock();
    const next = jest.fn();

    authAdminMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
