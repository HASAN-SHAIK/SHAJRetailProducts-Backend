const mockVerifyTenantToken = jest.fn();
const mockResolveTenantContext = jest.fn();

jest.mock('../utils/jwt', () => ({
  DEFAULT_TENANT_COOKIE: 'token',
  getTokenFromRequest: jest.fn(() => 'signed-token'),
  verifyTenantToken: (...args) => mockVerifyTenantToken(...args),
}));

jest.mock('../config/tenantDbResolver', () => ({
  resolveTenantContext: (...args) => mockResolveTenantContext(...args),
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

const tokenFor = (role, extras = {}) => ({
  type: 'tenant',
  tenant_id: 'tenant-1',
  user_id: '44',
  role,
  ...extras,
});

describe('V1 tenant role authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveTenantContext.mockResolvedValue(activeContext);
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
    expect(mockResolveTenantContext).toHaveBeenCalledWith('tenant-1');
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

  test('rejects a stale JWT when current Central tenant state is disabled', async () => {
    mockVerifyTenantToken.mockReturnValue(tokenFor('admin', { tenant_active: true }));
    mockResolveTenantContext.mockResolvedValue({
      tenant: { id: 'tenant-1', is_active: false },
      tenantPool: { query: jest.fn() },
      planFeatures: {},
    });
    const req = {};
    const res = responseMock();
    const next = jest.fn();

    await authTenantMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('TENANT_DISABLED');
    expect(mockResolveTenantContext).toHaveBeenCalledWith('tenant-1');
  });

  test('rejects when current Central tenant context no longer exists', async () => {
    mockVerifyTenantToken.mockReturnValue(tokenFor('cashier', { tenant_active: true }));
    mockResolveTenantContext.mockResolvedValue(null);
    const req = {};
    const res = responseMock();
    const next = jest.fn();

    await authTenantMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('TENANT_DISABLED');
  });
});
