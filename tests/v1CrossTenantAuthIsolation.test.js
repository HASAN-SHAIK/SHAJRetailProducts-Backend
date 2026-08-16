const fs = require('fs');
const path = require('path');

const mockVerifyTenantToken = jest.fn();
const mockResolveTenantContext = jest.fn();

jest.mock('../src/utils/jwt', () => ({
  DEFAULT_TENANT_COOKIE: 'token',
  getTokenFromRequest: jest.fn(() => 'signed-token'),
  verifyTenantToken: (...args) => mockVerifyTenantToken(...args),
}));

jest.mock('../src/config/tenantDbResolver', () => ({
  resolveTenantContext: (...args) => mockResolveTenantContext(...args),
}));

const { authTenantMiddleware } = require('../src/middleware/authTenant');

const responseMock = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('V1 cross-tenant authentication isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveTenantContext.mockResolvedValue({
      tenant: { id: 'tenant-a', is_active: true },
      tenantPool: { query: jest.fn() },
      planFeatures: {},
    });
  });

  test('verified tenant claim selects the tenant context even when request metadata tries another tenant', async () => {
    mockVerifyTenantToken.mockReturnValue({
      type: 'tenant',
      tenant_id: 'tenant-a',
      user_id: 'user-a',
      role: 'admin',
    });
    const req = {
      headers: { 'x-tenant-id': 'tenant-b' },
      body: { tenant_id: 'tenant-b' },
      query: { tenant_id: 'tenant-b' },
    };
    const res = responseMock();
    const next = jest.fn();

    await authTenantMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenant_id).toBe('tenant-a');
    expect(mockResolveTenantContext).toHaveBeenCalledTimes(1);
    expect(mockResolveTenantContext).toHaveBeenCalledWith('tenant-a');
    expect(mockResolveTenantContext).not.toHaveBeenCalledWith('tenant-b');
  });

  test('refresh tenant selection is bound to the refresh token tenant prefix, not caller-selected tenant input', () => {
    const controller = source('src/controllers/authController.js');
    expect(controller).toContain('const tenantId = parseRefreshTenantId(rawRefreshToken);');
    expect(controller).toContain('const tenant = await getTenantById(tenantId);');
    expect(controller).toContain('consumeAndRotateRefreshToken(tenantPool, rawRefreshToken, tenant.id)');
    expect(controller).not.toContain('req.body?.tenant_id');
  });

  test('platform-admin verification remains on its dedicated signing authority', () => {
    const jwtUtils = source('src/utils/jwt.js');
    expect(jwtUtils).toContain("const secret = process.env.ADMIN_JWT_SECRET;");
    expect(jwtUtils).toContain("throw new Error('ADMIN_JWT_SECRET is required for platform-admin authentication')");
    expect(jwtUtils).toContain('jwt.verify(token, getAdminJwtSecret())');
  });
});
