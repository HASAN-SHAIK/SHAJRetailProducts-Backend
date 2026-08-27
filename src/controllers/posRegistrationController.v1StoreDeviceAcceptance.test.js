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
const identity = { store_number: 'STORE-001', pos_no: 'POS-01', touchpoint_id: 'TP-01' };

beforeEach(() => {
  jest.clearAllMocks();
});

test('first-run request requires Store Number POS No and Touchpoint ID', async () => {
  const pool = poolWith(async () => ({ rowCount: 0, rows: [] }));
  mockResolveTenantContext.mockResolvedValue({ tenant: { is_active: true }, tenantPool: pool });
  const res = response();

  await createRegistrationRequest(request({
    body: { device_id: 'pos-1' },
    headers: { 'x-pos-tenant-id': 'tenant-a' },
  }), res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'POS_BUSINESS_IDENTITY_REQUIRED' }));
});

test('first-run request resolves the internal branch from Store Number and rejects duplicate pending registration', async () => {
  const pool = poolWith(async (sql) => {
    if (sql.includes('FROM branches WHERE UPPER(store_number)')) {
      return { rowCount: 1, rows: [{ id: 'branch-a', store_number: 'STORE-001', is_active: true }] };
    }
    if (sql.includes('FROM branch_devices WHERE device_id=')) return { rowCount: 0, rows: [] };
    if (sql.includes('FROM branch_devices WHERE UPPER(store_number)')) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT request_id,status') || sql.includes('SELECT request_id, status')) {
      return { rowCount: 1, rows: [{ request_id: 'posreg_existing', status: 'PENDING' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  mockResolveTenantContext.mockResolvedValue({ tenant: { is_active: true }, tenantPool: pool });
  const res = response();

  await createRegistrationRequest(request({
    body: { device_id: 'pos-1', ...identity },
    headers: { 'x-pos-tenant-id': 'tenant-a' },
  }), res, jest.fn());

  expect(mockResolveTenantContext).toHaveBeenCalledWith('tenant-a');
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REGISTRATION_REQUEST_EXISTS', request_id: 'posreg_existing', status: 'PENDING' }));
});

test('the same physical device ID remains isolated across tenant databases', async () => {
  const insertedA = [];
  const insertedB = [];
  const tenantPool = (inserted) => poolWith(async (sql, params = []) => {
    if (sql.includes('FROM branches WHERE UPPER(store_number)')) return { rowCount: 1, rows: [{ id: 'branch-a', store_number: 'STORE-001', is_active: true }] };
    if (sql.includes('FROM branch_devices WHERE device_id=') || sql.includes('FROM branch_devices WHERE UPPER(store_number)')) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT request_id,status') || sql.includes('SELECT request_id, status')) return { rowCount: 0, rows: [] };
    if (sql.includes('INSERT INTO pos_registration_requests')) {
      inserted.push({ deviceId: params[1], storeNumber: params[7], posNo: params[8], touchpointId: params[9] });
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  const poolA = tenantPool(insertedA);
  const poolB = tenantPool(insertedB);
  mockResolveTenantContext.mockImplementation(async (tenantId) => ({ tenant: { is_active: true }, tenantPool: tenantId === 'tenant-a' ? poolA : poolB }));

  const responseA = response();
  await createRegistrationRequest(request({ body: { device_id: 'shared-device', ...identity }, headers: { 'x-pos-tenant-id': 'tenant-a' } }), responseA, jest.fn());
  const responseB = response();
  await createRegistrationRequest(request({ body: { device_id: 'shared-device', ...identity }, headers: { 'x-pos-tenant-id': 'tenant-b' } }), responseB, jest.fn());

  expect(responseA.status).toHaveBeenCalledWith(201);
  expect(responseB.status).toHaveBeenCalledWith(201);
  expect(insertedA[0]).toEqual(expect.objectContaining({ deviceId: 'shared-device', storeNumber: 'STORE-001', posNo: 'POS-01', touchpointId: 'TP-01' }));
  expect(insertedB[0]).toEqual(expect.objectContaining({ deviceId: 'shared-device', storeNumber: 'STORE-001', posNo: 'POS-01', touchpointId: 'TP-01' }));
  expect(poolA.query).not.toBe(poolB.query);
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
  await registrationStatus(request({ params: { requestId: 'posreg-1' }, headers: { 'x-pos-tenant-id': 'tenant-a', 'x-pos-registration-token': 'wrong-token' } }), res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ code: 'REGISTRATION_REQUEST_NOT_FOUND' });
});

test('admin approval licenses the exact Store POS Touchpoint identity and preserves device limits', async () => {
  const pending = { device_id: 'pos-2', device_name: 'Register 2', os_info: 'linux', branch_id: 'branch-a', ...identity };
  const pool = poolWith(async (sql) => {
    if (sql.includes("WHERE request_id=$1 AND status='PENDING'")) return { rowCount: 1, rows: [pending] };
    if (sql.includes("SET status='APPROVED'")) throw new Error('approval update must not run after licensing rejection');
    return { rowCount: 0, rows: [] };
  });
  mockEnsureDeviceRegistration.mockResolvedValue({ allowed: false, code: 'DEVICE_LIMIT_REACHED', limit: 2 });
  const res = response();

  await approveRegistrationRequest(request({ tenantPool: pool, params: { requestId: 'posreg-2' }, user: { user_id: 'admin-1' } }), res, jest.fn());

  expect(mockEnsureDeviceRegistration).toHaveBeenCalledWith(expect.objectContaining({
    tenantPool: pool,
    branchId: 'branch-a',
    deviceId: 'pos-2',
    userId: 'admin-1',
    mode: 'register',
    businessIdentity: identity,
  }));
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ code: 'DEVICE_LIMIT_REACHED', limit: 2, active_device_id: undefined });
});

test('Central rejects an active Store POS Touchpoint assignment owned by another device', async () => {
  const pending = { device_id: 'replacement-pos', device_name: 'Replacement', os_info: 'linux', branch_id: 'branch-a', ...identity };
  const pool = poolWith(async (sql) => {
    if (sql.includes("WHERE request_id=$1 AND status='PENDING'")) return { rowCount: 1, rows: [pending] };
    return { rowCount: 0, rows: [] };
  });
  mockEnsureDeviceRegistration.mockResolvedValue({ allowed: false, code: 'POS_IDENTITY_IN_USE', activeDeviceId: 'old-pos' });
  const res = response();

  await approveRegistrationRequest(request({ tenantPool: pool, params: { requestId: 'posreg-replacement' }, user: { user_id: 'admin-1' } }), res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'POS_IDENTITY_IN_USE', active_device_id: 'old-pos' }));
});

test('Central allows replacement after the previous device is inactive', async () => {
  const pending = { device_id: 'replacement-pos', device_name: 'Replacement', os_info: 'linux', branch_id: 'branch-a', ...identity };
  const pool = poolWith(async (sql) => {
    if (sql.includes("WHERE request_id=$1 AND status='PENDING'")) return { rowCount: 1, rows: [pending] };
    if (sql.includes("SET status='APPROVED'")) return { rowCount: 1, rows: [{ request_id: 'posreg-replacement', device_id: 'replacement-pos', status: 'APPROVED', branch_id: 'branch-a', ...identity, terminal_id: 'POS-01' }] };
    return { rowCount: 0, rows: [] };
  });
  mockEnsureDeviceRegistration.mockResolvedValue({ allowed: true, limit: 2 });
  const res = response();

  await approveRegistrationRequest(request({ tenantPool: pool, params: { requestId: 'posreg-replacement' }, user: { user_id: 'admin-1' } }), res, jest.fn());

  expect(mockEnsureDeviceRegistration).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-a', deviceId: 'replacement-pos', mode: 'register', businessIdentity: identity }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'APPROVED', store_number: 'STORE-001', pos_no: 'POS-01', touchpoint_id: 'TP-01' }));
});

test('approved request can be claimed exactly once with its token and full identity', async () => {
  let claimed = false;
  const pool = poolWith(async (sql) => {
    if (sql.includes("SET status='CLAIMED'")) {
      if (claimed) return { rowCount: 0, rows: [] };
      claimed = true;
      return { rowCount: 1, rows: [{ request_id: 'posreg-3', device_id: 'pos-3', branch_id: 'branch-a', ...identity, terminal_id: 'POS-01', status: 'CLAIMED' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  mockResolveTenantContext.mockResolvedValue({ tenant: { is_active: true }, tenantPool: pool });
  const req = request({ params: { requestId: 'posreg-3' }, headers: { 'x-pos-tenant-id': 'tenant-a', 'x-pos-registration-token': 'claim-token' } });
  const first = response();
  await claimRegistration(req, first, jest.fn());
  expect(first.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'CLAIMED', store_number: 'STORE-001', pos_no: 'POS-01', touchpoint_id: 'TP-01' }));

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
