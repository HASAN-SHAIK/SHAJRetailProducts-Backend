const mockResolveTenantContext = jest.fn();
const mockEnsureDeviceRegistration = jest.fn();

jest.mock('../config/tenantDbResolver', () => ({
  resolveTenantContext: (...args) => mockResolveTenantContext(...args),
}));
jest.mock('../utils/branchDeviceLicensing', () => ({
  ensureDeviceRegistration: (...args) => mockEnsureDeviceRegistration(...args),
}));

const {
  createRegistrationRequest,
  registrationStatus,
  claimRegistration,
  approveRegistrationRequest,
  rejectRegistrationRequest,
} = require('./posRegistrationController');

const response = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const request = ({ body = {}, params = {}, query = {}, headers = {}, tenantPool, user } = {}) => ({
  body,
  params,
  query,
  tenantPool,
  user,
  get: (name) => headers[name.toLowerCase()] || headers[name] || undefined,
});

const poolWith = (handler) => ({ query: jest.fn(handler) });

beforeEach(() => {
  jest.clearAllMocks();
});

test('first-run request is tenant-bound and rejects duplicate pending device registration', async () => {
  const pool = poolWith(async (sql) => {
    if (sql.includes('SELECT request_id, status')) {
      return { rowCount: 1, rows: [{ request_id: 'posreg_existing', status: 'PENDING' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  mockResolveTenantContext.mockResolvedValue({ tenant: { is_active: true }, tenantPool: pool });
  const res = response();

  await createRegistrationRequest(request({
    body: { device_id: 'pos-1' },
    headers: { 'x-pos-tenant-id': 'tenant-a' },
  }), res, jest.fn());

  expect(mockResolveTenantContext).toHaveBeenCalledWith('tenant-a');
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'REGISTRATION_REQUEST_EXISTS',
    request_id: 'posreg_existing',
    status: 'PENDING',
  }));
});

test('registration status requires the exact token-bound request', async () => {
  const pool = poolWith(async (sql, params) => {
    if (sql.includes('FROM pos_registration_requests WHERE request_id=$1 AND request_token_hash=$2')) {
      expect(params[0]).toBe('posreg-1');
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  mockResolveTenantContext.mockResolvedValue({ tenant: { is_active: true }, tenantPool: pool });
  const res = response();

  await registrationStatus(request({
    params: { requestId: 'posreg-1' },
    headers: { 'x-pos-tenant-id': 'tenant-a', 'x-pos-registration-token': 'wrong-token' },
  }), res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ code: 'REGISTRATION_REQUEST_NOT_FOUND' });
});

test('admin approval uses canonical licensing and does not approve when the device limit rejects registration', async () => {
  const pending = { device_id: 'pos-2', device_name: 'Register 2', os_info: 'linux' };
  const pool = poolWith(async (sql) => {
    if (sql.includes("WHERE request_id=$1 AND status='PENDING'")) {
      return { rowCount: 1, rows: [pending] };
    }
    if (sql.includes("SET status='APPROVED'")) {
      throw new Error('approval update must not run after licensing rejection');
    }
    return { rowCount: 0, rows: [] };
  });
  mockEnsureDeviceRegistration.mockResolvedValue({ allowed: false, code: 'DEVICE_LIMIT_REACHED', limit: 2 });
  const res = response();

  await approveRegistrationRequest(request({
    tenantPool: pool,
    params: { requestId: 'posreg-2' },
    body: { branch_id: 'branch-a', terminal_id: 'T-02' },
    user: { user_id: 'admin-1' },
  }), res, jest.fn());

  expect(mockEnsureDeviceRegistration).toHaveBeenCalledWith(expect.objectContaining({
    tenantPool: pool,
    branchId: 'branch-a',
    deviceId: 'pos-2',
    userId: 'admin-1',
    mode: 'register',
  }));
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ code: 'DEVICE_LIMIT_REACHED', limit: 2 });
});

test('approved request can be claimed exactly once with its token', async () => {
  let claimed = false;
  const pool = poolWith(async (sql) => {
    if (sql.includes("SET status='CLAIMED'")) {
      if (claimed) return { rowCount: 0, rows: [] };
      claimed = true;
      return { rowCount: 1, rows: [{
        request_id: 'posreg-3', device_id: 'pos-3', branch_id: 'branch-a', terminal_id: 'T-03', status: 'CLAIMED',
      }] };
    }
    return { rowCount: 0, rows: [] };
  });
  mockResolveTenantContext.mockResolvedValue({ tenant: { is_active: true }, tenantPool: pool });

  const req = request({
    params: { requestId: 'posreg-3' },
    headers: { 'x-pos-tenant-id': 'tenant-a', 'x-pos-registration-token': 'claim-token' },
  });
  const first = response();
  await claimRegistration(req, first, jest.fn());
  expect(first.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'CLAIMED', branch_id: 'branch-a', terminal_id: 'T-03' }));

  const replay = response();
  await claimRegistration(req, replay, jest.fn());
  expect(replay.status).toHaveBeenCalledWith(409);
  expect(replay.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REGISTRATION_NOT_APPROVED' }));
});

test('rejection is pending-only and therefore replay-safe', async () => {
  let pending = true;
  const pool = poolWith(async (sql) => {
    if (sql.includes("SET status='REJECTED'")) {
      if (!pending) return { rowCount: 0, rows: [] };
      pending = false;
      return { rowCount: 1, rows: [{ request_id: 'posreg-4', status: 'REJECTED' }] };
    }
    return { rowCount: 0, rows: [] };
  });

  const req = request({ tenantPool: pool, params: { requestId: 'posreg-4' }, user: { id: 'admin-1' } });
  const first = response();
  await rejectRegistrationRequest(req, first, jest.fn());
  expect(first.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'REJECTED' }));

  const replay = response();
  await rejectRegistrationRequest(req, replay, jest.fn());
  expect(replay.status).toHaveBeenCalledWith(409);
  expect(replay.json).toHaveBeenCalledWith({ code: 'REGISTRATION_NOT_PENDING' });
});
