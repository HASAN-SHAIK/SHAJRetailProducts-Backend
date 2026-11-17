const mockProvisionTenant = jest.fn();
const mockGetTenantByDomain = jest.fn();
const mockGetTenantById = jest.fn();
const mockGetTenantPool = jest.fn();
const mockCloseTenantPool = jest.fn();
const mockRegisterTenantLoginEntry = jest.fn();
const mockCreateBranch = jest.fn();
const mockGetBranches = jest.fn();
const mockIssueMobileAuthSession = jest.fn();
const mockAdminQuery = jest.fn();
const mockMasterQuery = jest.fn();

jest.mock('../services/tenantProvisionService', () => ({
  provisionTenant: (...args) => mockProvisionTenant(...args),
}));

jest.mock('../services/tenantService', () => ({
  getTenantByDomain: (...args) => mockGetTenantByDomain(...args),
  getTenantById: (...args) => mockGetTenantById(...args),
}));

jest.mock('../db/tenantPool', () => ({
  getTenantPool: (...args) => mockGetTenantPool(...args),
  closeTenantPool: (...args) => mockCloseTenantPool(...args),
}));

jest.mock('../db/adminPool', () => ({
  query: (...args) => mockAdminQuery(...args),
}));

jest.mock('../db/masterPool', () => ({
  query: (...args) => mockMasterQuery(...args),
}));

jest.mock('../services/tenantLoginDirectoryService', () => ({
  registerTenantLoginEntry: (...args) => mockRegisterTenantLoginEntry(...args),
}));

jest.mock('../services/branchService', () => ({
  createBranch: (...args) => mockCreateBranch(...args),
  getBranches: (...args) => mockGetBranches(...args),
}));

jest.mock('../controllers/authController', () => ({
  issueMobileAuthSession: (...args) => mockIssueMobileAuthSession(...args),
}));

const {
  createCompanyHandler,
  getOnboardingStatusHandler,
} = require('./onboardingController');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('onboardingController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validates required fields for self-serve company creation', async () => {
    const res = makeRes();
    await createCompanyHandler({ body: { shop_name: 'A' }, headers: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('VALIDATION_ERROR');
    expect(mockProvisionTenant).not.toHaveBeenCalled();
  });

  test('provisions company, admin user, first store, login directory, and mobile tokens', async () => {
    mockGetTenantByDomain.mockResolvedValue(null);
    mockProvisionTenant.mockResolvedValue({ tenant_id: 55, database_name: 'shaj_tenant_55' });
    mockGetTenantById.mockResolvedValue({
      id: 55,
      shop_name: 'Lakshmi Supermarket',
      domain: 'lakshmi-supermarket',
      database_name: 'shaj_tenant_55',
      plan_type: 'basic',
      gst_mode: 'INCLUSIVE',
      is_active: true,
    });
    const tenantQuery = jest.fn(async (sql) => {
      if (sql.includes('INSERT INTO users')) {
        return {
          rowCount: 1,
          rows: [{ id: 1, name: 'Lakshmi', email: 'lakshmi@gmail.com', role: 'admin', all_branch_access: true }],
        };
      }
      return { rowCount: 0, rows: [] };
    });
    mockGetTenantPool.mockReturnValue({ query: tenantQuery });
    mockCreateBranch.mockResolvedValue({
      id: 'branch-1',
      store_number: 'STORE-001',
      name: 'Main Store',
      location: 'Chennai',
      is_active: true,
    });
    mockIssueMobileAuthSession.mockResolvedValue({
      access_token: 'jwt-token',
      refresh_token: '55.refresh',
      token_type: 'Bearer',
      user: { id: 1, email: 'lakshmi@gmail.com', role: 'admin' },
      tenant: { id: 55, name: 'Lakshmi Supermarket', company_code: 'lakshmi-supermarket' },
    });

    const res = makeRes();
    await createCompanyHandler({
      body: {
        shop_name: 'Lakshmi Supermarket',
        owner_name: 'Lakshmi',
        email: 'lakshmi@gmail.com',
        mobile: '9876543210',
        password: 'StrongPassword1',
        city: 'Chennai',
        store_name: 'Main Store',
        store_number: 'store-001',
      },
      headers: { 'x-device-id': 'mobile-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockProvisionTenant).toHaveBeenCalledWith(expect.objectContaining({
      shop_name: 'Lakshmi Supermarket',
      domain: 'lakshmi-supermarket',
      plan_type: 'basic',
    }));
    expect(mockCreateBranch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ store_number: 'STORE-001', name: 'Main Store', location: 'Chennai' })
    );
    expect(mockRegisterTenantLoginEntry).toHaveBeenCalledWith({
      tenantId: 55,
      email: 'lakshmi@gmail.com',
      mobile: '9876543210',
      companyCode: 'lakshmi-supermarket',
    });
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({
      success: true,
      access_token: 'jwt-token',
      company_code: 'lakshmi-supermarket',
    }));
  });

  test('self-serve trial ignores a requested higher plan and always provisions basic', async () => {
    mockGetTenantByDomain.mockResolvedValue(null);
    mockProvisionTenant.mockResolvedValue({ tenant_id: 66, database_name: 'shaj_tenant_66' });
    mockGetTenantById.mockResolvedValue({
      id: 66, shop_name: 'Plan Shop', domain: 'plan-shop', database_name: 'shaj_tenant_66', plan_type: 'basic',
    });
    mockGetTenantPool.mockReturnValue({
      query: jest.fn(async () => ({ rowCount: 1, rows: [{ id: 1, role: 'admin', email: 'p@x.com' }] })),
    });
    mockCreateBranch.mockResolvedValue({ id: 'b1', name: 'Main Store', is_active: true });
    mockIssueMobileAuthSession.mockResolvedValue({ access_token: 't', refresh_token: 'r' });

    const res = makeRes();
    await createCompanyHandler({
      body: {
        shop_name: 'Plan Shop', owner_name: 'Owner', email: 'p@x.com', mobile: '9876543210',
        password: 'StrongPassword1', plan_type: 'premium',
      },
      headers: {},
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockProvisionTenant).toHaveBeenCalledWith(expect.objectContaining({ plan_type: 'basic', subscription_status: 'trial', subscription_amount: 0 }));
    const body = res.json.mock.calls[0][0];
    expect(body.subscription).toEqual(expect.objectContaining({ status: 'trial', days_left: expect.any(Number) }));
  });

  test('rolls back provisioned tenant database if initial store creation fails', async () => {
    mockGetTenantByDomain.mockResolvedValue(null);
    mockProvisionTenant.mockResolvedValue({ tenant_id: 77, database_name: 'shaj_tenant_77' });
    mockGetTenantById.mockResolvedValue({
      id: 77,
      shop_name: 'Broken Shop',
      domain: 'broken-shop',
      database_name: 'shaj_tenant_77',
      plan_type: 'basic',
    });
    mockGetTenantPool.mockReturnValue({
      query: jest.fn(async () => ({ rowCount: 1, rows: [{ id: 1, role: 'admin' }] })),
    });
    mockCreateBranch.mockRejectedValue(new Error('branch failed'));

    const res = makeRes();
    await createCompanyHandler({
      body: {
        shop_name: 'Broken Shop',
        owner_name: 'Owner',
        email: 'owner@gmail.com',
        mobile: '9876543210',
        password: 'StrongPassword1',
      },
      headers: {},
    }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockCloseTenantPool).toHaveBeenCalledWith('shaj_tenant_77');
    expect(mockAdminQuery).toHaveBeenCalledWith('DROP DATABASE IF EXISTS "shaj_tenant_77"');
    expect(mockMasterQuery).toHaveBeenCalledWith('DELETE FROM tenants WHERE id = $1', [77]);
  });

  test('returns onboarding checklist status for authenticated tenant', async () => {
    mockGetBranches.mockResolvedValue([
      { id: 'b1', store_number: 'STORE-001', name: 'Main Store', location: 'Hyderabad', is_active: true },
    ]);
    const tenantPool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM shop_details')) {
          return { rows: [{ shop_name: 'Test Shop', owner_name: 'Ali', mobile_number: '9999999999', address_line: 'MG Road' }] };
        }
        if (sql.includes('FROM branch_devices')) {
          return { rows: [{ branch_id: 'b1', active_count: 1 }] };
        }
        if (sql.includes('FROM pos_registration_requests')) {
          return { rows: [{ pending_count: 2 }] };
        }
        if (sql.includes('FROM users')) {
          return { rows: [{ total_users: 2, staff_count: 1 }] };
        }
        return { rows: [] };
      }),
    };
    const res = makeRes();

    await getOnboardingStatusHandler({
      tenant: { id: 5, shop_name: 'Test Shop', domain: 'test-shop', plan_type: 'basic', gst_mode: 'INCLUSIVE' },
      tenantPool,
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0].data;
    expect(data.checklist).toEqual({
      company_created: true,
      business_profile_completed: true,
      store_created: true,
      staff_added: true,
      pos_onboarded: true,
    });
    expect(data.pos_devices).toEqual({ active_count: 1, pending_requests_count: 2 });
  });

  test('onboarding status exposes trial subscription state additively', async () => {
    mockGetBranches.mockResolvedValue([]);
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockMasterQuery.mockResolvedValueOnce({ rows: [{ payment_status: 'trial', end_date: future }] });
    const res = makeRes();
    await getOnboardingStatusHandler({
      tenant: { id: 5, shop_name: 'T', domain: 't', plan_type: 'basic' },
      tenantPool: { query: jest.fn(async () => ({ rows: [] })) },
    }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data.subscription).toEqual({ status: 'trial', ends_at: future, days_left: 5 });
    expect(data.checklist).toBeDefined();
  });
});
