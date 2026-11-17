const mockMasterQuery = jest.fn();
const mockGetTenantByDomain = jest.fn();
const mockGetTenantById = jest.fn();

jest.mock('../db/masterPool', () => ({
  query: (...args) => mockMasterQuery(...args),
}));

jest.mock('./tenantService', () => ({
  getTenantByDomain: (...args) => mockGetTenantByDomain(...args),
  getTenantById: (...args) => mockGetTenantById(...args),
}));

const {
  registerTenantLoginEntry,
  resolveTenantsForLogin,
  resetDirectorySchemaCacheForTests,
} = require('./tenantLoginDirectoryService');

describe('tenantLoginDirectoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDirectorySchemaCacheForTests();
    mockMasterQuery.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  test('resolves unique personal-email tenant from login directory', async () => {
    const tenantRow = {
      id: 42,
      shop_name: 'Ramesh Kirana',
      domain: 'ramesh-kirana',
      database_name: 'shaj_tenant_42',
      plan_type: 'basic',
      is_active: true,
    };
    mockMasterQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM tenant_login_directory d')) {
        return { rowCount: 1, rows: [tenantRow] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await resolveTenantsForLogin({ email: 'ramesh.shop@gmail.com' });

    expect(result.ambiguous).toBe(false);
    expect(result.tenant).toEqual(expect.objectContaining({
      id: 42,
      shop_name: 'Ramesh Kirana',
      company_code: 'ramesh-kirana',
    }));
    expect(mockGetTenantByDomain).not.toHaveBeenCalled();
  });

  test('flags ambiguous resolution when one email belongs to multiple companies', async () => {
    mockMasterQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM tenant_login_directory d')) {
        return {
          rowCount: 2,
          rows: [
            { id: 10, shop_name: 'Shop One', domain: 'shop-one', database_name: 'db_10', is_active: true },
            { id: 11, shop_name: 'Shop Two', domain: 'shop-two', database_name: 'db_11', is_active: true },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await resolveTenantsForLogin({ email: 'owner@gmail.com' });

    expect(result.ambiguous).toBe(true);
    expect(result.tenant).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.company_code)).toEqual(['shop-one', 'shop-two']);
  });

  test('explicit company_code resolves directly without ambiguity', async () => {
    mockGetTenantByDomain.mockResolvedValue({ id: 11, shop_name: 'Shop Two', domain: 'shop-two' });

    const result = await resolveTenantsForLogin({
      email: 'owner@gmail.com',
      companyCode: 'SHOP-TWO',
    });

    expect(mockGetTenantByDomain).toHaveBeenCalledWith('shop-two');
    expect(result.ambiguous).toBe(false);
    expect(result.tenant.id).toBe(11);
  });

  test('falls back to email-domain lookup when email is not yet in directory', async () => {
    mockGetTenantByDomain.mockResolvedValue({ id: 7, shop_name: 'Legacy Mart', domain: 'legacymart' });

    const result = await resolveTenantsForLogin({ email: 'admin@legacymart.com' });

    expect(mockGetTenantByDomain).toHaveBeenCalledWith('legacymart');
    expect(result.tenant.id).toBe(7);
  });

  test('registerTenantLoginEntry normalizes email and company code', async () => {
    mockMasterQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO tenant_login_directory')) {
        return { rowCount: 1, rows: [{ id: 1, tenant_id: 5, email: 'owner@gmail.com', company_code: 'my-shop' }] };
      }
      return { rowCount: 0, rows: [] };
    });

    const entry = await registerTenantLoginEntry({
      tenantId: 5,
      email: 'Owner@Gmail.com',
      mobile: '9876543210',
      companyCode: 'MY-SHOP',
    });

    expect(entry.email).toBe('owner@gmail.com');
    expect(entry.company_code).toBe('my-shop');
  });
});
