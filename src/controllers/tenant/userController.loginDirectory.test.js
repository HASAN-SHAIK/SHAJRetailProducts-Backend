const mockRegister = jest.fn();
const mockGetTenantById = jest.fn();

jest.mock('../../services/tenantLoginDirectoryService', () => ({
  registerTenantLoginEntry: (...a) => mockRegister(...a),
}));
jest.mock('../../services/tenantService', () => ({
  getTenantById: (...a) => mockGetTenantById(...a),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hashed') }));

const { createUser } = require('./userController');
const { backfillLoginDirectory, maskEmail } = require('../../../scripts/backfill-login-directory.cjs');

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = ({ tenant, body } = {}) => ({
  tenant,
  user: { id: 1, role: 'admin', tenant_id: 7 },
  body: { name: 'Aasim', email: 'Aasim@Gmail.com', password: 'Manager1234', role: 'manager', all_branch_access: true, ...body },
  tenantPool: {
    query: jest.fn(async (sql) => {
      if (/SELECT id FROM users/i.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO users/i.test(sql)) {
        return { rowCount: 1, rows: [{ id: 9, name: 'Aasim', email: 'aasim@gmail.com', role: 'manager', branch_id: null, all_branch_access: true }] };
      }
      return { rowCount: 0, rows: [] };
    }),
  },
});

describe('createUser login directory sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRegister.mockResolvedValue({ id: 1 });
  });

  test('registers the new user with the tenant company code and reports synced', async () => {
    const res = makeRes();
    await createUser(makeReq({ tenant: { id: 7, domain: 'my-shop' } }), res);
    expect(mockRegister).toHaveBeenCalledWith({ tenantId: 7, email: 'aasim@gmail.com', companyCode: 'my-shop' });
    expect(mockGetTenantById).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.data.login_directory_synced).toBe(true);
    expect(body.data.user.role).toBe('manager');
  });

  test('loads the company code when the request tenant object lacks it (no silent skip)', async () => {
    mockGetTenantById.mockResolvedValue({ id: 7, domain: 'loaded-shop' });
    const res = makeRes();
    await createUser(makeReq({ tenant: { id: 7 } }), res);
    expect(mockGetTenantById).toHaveBeenCalledWith(7);
    expect(mockRegister).toHaveBeenCalledWith({ tenantId: 7, email: 'aasim@gmail.com', companyCode: 'loaded-shop' });
    expect(res.json.mock.calls[0][0].data.login_directory_synced).toBe(true);
  });

  test('a directory failure does not fail user creation but is reported, not hidden', async () => {
    mockRegister.mockRejectedValue(new Error('master db down'));
    const res = makeRes();
    await createUser(makeReq({ tenant: { id: 7, domain: 'my-shop' } }), res);
    const body = res.json.mock.calls[0][0];
    expect(body.data.user.email).toBe('aasim@gmail.com');
    expect(body.data.login_directory_synced).toBe(false);
    expect(body.message).toMatch(/sign-in lookup could not be updated/i);
  });

  test('missing company code everywhere is reported as not synced', async () => {
    mockGetTenantById.mockResolvedValue({ id: 7, domain: null });
    const res = makeRes();
    await createUser(makeReq({ tenant: { id: 7 } }), res);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.login_directory_synced).toBe(false);
  });
});

describe('backfill-login-directory', () => {
  const makePools = (tenantUsers, directory = []) => {
    const masterPool = {
      query: jest.fn(async (sql) => {
        if (/FROM tenants/i.test(sql)) {
          return { rows: [
            { id: 1, domain: 'shop-one', database_name: 'db1', shop_name: 'One' },
            { id: 2, domain: 'shop-two', database_name: 'db2', shop_name: 'Two' },
          ] };
        }
        if (/FROM tenant_login_directory/i.test(sql)) return { rows: directory };
        return { rows: [] };
      }),
    };
    const getTenantPool = (db) => ({
      query: jest.fn(async () => {
        if (!tenantUsers[db]) throw new Error(`no such database ${db}`);
        return { rows: tenantUsers[db].map((email) => ({ email })) };
      }),
    });
    return { masterPool, getTenantPool };
  };

  test('dry run reports missing users and writes nothing', async () => {
    const register = jest.fn();
    const { masterPool, getTenantPool } = makePools(
      { db1: ['owner@a.com', 'aasim@gmail.com'], db2: ['x@b.com'] },
      [{ tenant_id: 1, email: 'owner@a.com' }, { tenant_id: 2, email: 'x@b.com' }]
    );
    const s = await backfillLoginDirectory({ masterPool, getTenantPool, registerTenantLoginEntry: register });
    expect(s).toMatchObject({ tenants: 2, users: 3, missing: 1, added: 0, errors: 0 });
    expect(s.details).toEqual([{ tenant_id: 1, company_code: 'shop-one', email: 'aasim@gmail.com' }]);
    expect(register).not.toHaveBeenCalled();
  });

  test('--apply writes only the missing rows with the tenant company code', async () => {
    const register = jest.fn(async () => ({ id: 1 }));
    const { masterPool, getTenantPool } = makePools(
      { db1: ['Owner@A.com', 'Aasim@Gmail.com'], db2: [] },
      [{ tenant_id: 1, email: 'owner@a.com' }]
    );
    const s = await backfillLoginDirectory({ masterPool, getTenantPool, registerTenantLoginEntry: register, apply: true });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({ tenantId: 1, email: 'aasim@gmail.com', companyCode: 'shop-one' });
    expect(s).toMatchObject({ missing: 1, added: 1, errors: 0 });
  });

  test('is idempotent: a second run finds nothing missing', async () => {
    const register = jest.fn(async () => ({ id: 1 }));
    const { masterPool, getTenantPool } = makePools(
      { db1: ['aasim@gmail.com'], db2: [] },
      [{ tenant_id: 1, email: 'aasim@gmail.com' }]
    );
    const s = await backfillLoginDirectory({ masterPool, getTenantPool, registerTenantLoginEntry: register, apply: true });
    expect(s.missing).toBe(0);
    expect(register).not.toHaveBeenCalled();
  });

  test('one unreadable tenant is counted as an error and the rest still run', async () => {
    const register = jest.fn(async () => ({ id: 1 }));
    const { masterPool, getTenantPool } = makePools({ db1: ['aasim@gmail.com'] }); // db2 missing -> throws
    const log = jest.fn();
    const s = await backfillLoginDirectory({ masterPool, getTenantPool, registerTenantLoginEntry: register, apply: true, log });
    expect(s.errors).toBe(1);
    expect(s.added).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/shop-two/));
  });

  test('emails are masked by default in output', () => {
    expect(maskEmail('aasim@gmail.com')).toBe('a***@gmail.com');
  });
});
