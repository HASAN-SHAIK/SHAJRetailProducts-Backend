const mockVerifyTenantToken = jest.fn();
const mockResolveTenantContextFromToken = jest.fn();

jest.mock('../utils/jwt', () => ({
  DEFAULT_TENANT_COOKIE: 'token',
  getTokenFromRequest: jest.fn(() => 'signed-token'),
  verifyTenantToken: (...args) => mockVerifyTenantToken(...args),
}));

jest.mock('../config/tenantDbResolver', () => ({
  resolveTenantContext: jest.fn(),
  resolveTenantContextFromToken: (...args) => mockResolveTenantContextFromToken(...args),
}));

const { authTenantMiddleware } = require('./authTenant');

const responseMock = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const activeContext = {
  tenant: { id: 'tenant-1', is_active: true },
  tenantPool: { query: jest.fn() },
  planFeatures: {},
};

const tokenFor = (role) => ({
  type: 'tenant',
  tenant_id: 'tenant-1',
  user_id: '44',
  role,
});

describe('V1 tenant role authentication', () => {
  beforeEach(() => {
    mockResolveTenantContextFromToken.mockReturnValue(activeContext);
  });

  test.each(['admin', 'staff', 'manager', 'cashier'])('accepts supported %s tokens', async (role) => {
    mockVerifyTenantToken.mockReturnValue(tokenFor(role));
    const req = {};
    const res = responseMock();
    const next = jest.fn();

    await authTenantMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.role).toBe(role);
    expect(req.tenantPool).toBe(activeContext.tenantPool);
  });

  test('normalizes supported role casing before downstream authorization', async () => {
    mockVerifyTenantToken.mockReturnValue(tokenFor('MANAGER'));
    const req = {};
    const res = responseMock();
    const next = jest.fn();

    await authTenantMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.role).toBe('manager');
  });

  test('rejects roles outside the authoritative permission catalog', async () => {
    mockVerifyTenantToken.mockReturnValue(tokenFor('owner'));
    const req = {};
    const res = responseMock();
    const next = jest.fn();

    await authTenantMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FORBIDDEN');
  });
});
