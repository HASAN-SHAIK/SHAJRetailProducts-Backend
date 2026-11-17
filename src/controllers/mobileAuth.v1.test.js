const mockGetTenantById = jest.fn();
const mockGetTenantByDomain = jest.fn();
const mockGetTenantPool = jest.fn();
const mockResolveTenantsForLogin = jest.fn();
const mockCreateRefreshToken = jest.fn();
const mockConsumeAndRotateRefreshToken = jest.fn();
const mockRevokeRefreshToken = jest.fn();
const mockBcryptCompare = jest.fn();

jest.mock('../services/tenantService', () => ({
  getTenantById: (...args) => mockGetTenantById(...args),
  getTenantByDomain: (...args) => mockGetTenantByDomain(...args),
}));

jest.mock('../db/tenantPool', () => ({
  getTenantPool: (...args) => mockGetTenantPool(...args),
}));

jest.mock('../services/tenantLoginDirectoryService', () => ({
  resolveTenantsForLogin: (...args) => mockResolveTenantsForLogin(...args),
}));

jest.mock('../services/authSessionService', () => ({
  createRefreshToken: (...args) => mockCreateRefreshToken(...args),
  consumeAndRotateRefreshToken: (...args) => mockConsumeAndRotateRefreshToken(...args),
  revokeRefreshToken: (...args) => mockRevokeRefreshToken(...args),
  getAccessTtlMs: () => 900000,
  getRefreshTtlMs: () => 2592000000,
}));

jest.mock('bcryptjs', () => ({
  compare: (...args) => mockBcryptCompare(...args),
  hash: jest.fn(async () => 'hashed'),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const {
  login,
  mobileLogin,
  mobileRefresh,
  mobileLogout,
} = require('./authController');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  return res;
};

describe('authController browser vs mobile auth isolation', () => {
  const tenant = {
    id: 9,
    shop_name: 'Kiran General Store',
    domain: 'kiran-general',
    database_name: 'shaj_tenant_9',
    plan_type: 'basic',
    is_active: true,
    gst_mode: 'INCLUSIVE',
    addons: {},
  };

  const user = {
    id: 1,
    name: 'Kiran',
    email: 'kiran@gmail.com',
    password: 'hashed-password',
    role: 'admin',
    branch_id: null,
    all_branch_access: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveTenantsForLogin.mockResolvedValue({ tenant, ambiguous: false, candidates: [tenant] });
    mockGetTenantPool.mockReturnValue({
      query: jest.fn(async () => ({ rowCount: 1, rows: [user] })),
    });
    mockBcryptCompare.mockResolvedValue(true);
    mockCreateRefreshToken.mockResolvedValue({ rawToken: '9.refresh-secret' });
  });

  test('browser login stays cookie-only and does not return tokens in JSON', async () => {
    const res = makeRes();
    await login({ body: { email: 'kiran@gmail.com', password: 'Password123' }, headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.cookie).toHaveBeenCalledTimes(2);
    const body = res.json.mock.calls[0][0];
    expect(body.access_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
    expect(body.user.email).toBe('kiran@gmail.com');
  });

  test('mobileLogin returns Bearer access_token and refresh_token without setting cookies', async () => {
    const res = makeRes();
    await mobileLogin({ body: { email: 'kiran@gmail.com', password: 'Password123' }, headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.cookie).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.access_token).toBe('string');
    expect(body.refresh_token).toBe('9.refresh-secret');
    expect(body.tenant.company_code).toBe('kiran-general');
  });

  test('mobileLogin returns 409 COMPANY_SELECTION_REQUIRED when email matches multiple shops', async () => {
    mockResolveTenantsForLogin.mockResolvedValue({
      tenant: null,
      ambiguous: true,
      candidates: [
        { id: 9, shop_name: 'Shop A', domain: 'shop-a', company_code: 'shop-a' },
        { id: 10, shop_name: 'Shop B', domain: 'shop-b', company_code: 'shop-b' },
      ],
    });
    const res = makeRes();
    await mobileLogin({ body: { email: 'kiran@gmail.com', password: 'Password123' }, headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({
      code: 'COMPANY_SELECTION_REQUIRED',
      companies: [
        { tenant_id: 9, shop_name: 'Shop A', company_code: 'shop-a' },
        { tenant_id: 10, shop_name: 'Shop B', company_code: 'shop-b' },
      ],
    }));
  });

  test('mobileRefresh rotates refresh token from JSON body and returns new tokens', async () => {
    mockGetTenantById.mockResolvedValue(tenant);
    mockConsumeAndRotateRefreshToken.mockResolvedValue({
      rawToken: '9.rotated-secret',
      row: {
        user_id: 1,
        name: 'Kiran',
        email: 'kiran@gmail.com',
        role: 'admin',
        branch_id: null,
        all_branch_access: true,
        remember_me: true,
      },
    });
    const res = makeRes();

    await mobileRefresh({ body: { refresh_token: '9.old-secret' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.cookie).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.refresh_token).toBe('9.rotated-secret');
    expect(typeof body.access_token).toBe('string');
  });

  test('mobileLogout revokes refresh_token passed in body', async () => {
    mockGetTenantById.mockResolvedValue(tenant);
    const pool = { query: jest.fn() };
    mockGetTenantPool.mockReturnValue(pool);
    const res = makeRes();

    await mobileLogout({ body: { refresh_token: '9.old-secret' } }, res);

    expect(mockRevokeRefreshToken).toHaveBeenCalledWith(pool, '9.old-secret');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
