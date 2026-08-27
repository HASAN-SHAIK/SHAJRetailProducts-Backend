const { ensureDeviceRegistration } = require('./branchDeviceLicensing');
const { resolveDevice } = require('../configuration/targets');

const poolWith = (handler) => ({ query: jest.fn(handler) });
const businessIdentity = {
  store_number: 'STORE-002',
  pos_no: 'POS-01',
  touchpoint_id: 'TP-01',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('active device cannot be registered on a second branch until the old registration is deactivated', async () => {
  const pool = poolWith(async (sql, params) => {
    if (sql.includes('FROM branches')) {
      return { rowCount: 1, rows: [{ id: 'branch-b', store_number: 'STORE-002', subscription_plan: 'enterprise', max_devices_allowed: null, is_active: true }] };
    }
    if (sql.includes('branch_id <> $2') && sql.includes('is_active = TRUE')) {
      expect(params).toEqual(['device-1', 'branch-b']);
      return { rowCount: 1, rows: [{ id: 10, branch_id: 'branch-a' }] };
    }
    if (sql.includes('INSERT INTO branch_device_logs')) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const result = await ensureDeviceRegistration({
    tenantPool: pool,
    branchId: 'branch-b',
    deviceId: 'device-1',
    userId: 'admin-1',
    mode: 'register',
    businessIdentity,
  });

  expect(result).toEqual(expect.objectContaining({
    allowed: false,
    code: 'DEVICE_BRANCH_CONFLICT',
    currentBranchId: 'branch-a',
    requestedBranchId: 'branch-b',
  }));
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO branch_devices'))).toBe(false);
});

test('device can be explicitly registered on a new branch after the old branch is inactive', async () => {
  const pool = poolWith(async (sql, params) => {
    if (sql.includes('FROM branches')) {
      return { rowCount: 1, rows: [{ id: 'branch-b', store_number: 'STORE-002', subscription_plan: 'enterprise', max_devices_allowed: null, is_active: true }] };
    }
    if (sql.includes('branch_id <> $2') && sql.includes('is_active = TRUE')) {
      expect(params).toEqual(['device-1', 'branch-b']);
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('UPPER(store_number)=$1') && sql.includes('UPPER(pos_no)=$2')) {
      expect(params).toEqual(['STORE-002', 'POS-01', 'TP-01', 'device-1']);
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('WHERE branch_id = $1 AND device_id = $2')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('INSERT INTO branch_devices')) {
      expect(params[0]).toBe('branch-b');
      expect(params[2]).toBe('device-1');
      expect(params.slice(8, 11)).toEqual(['STORE-002', 'POS-01', 'TP-01']);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('INSERT INTO branch_device_logs')) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const result = await ensureDeviceRegistration({
    tenantPool: pool,
    branchId: 'branch-b',
    deviceId: 'device-1',
    userId: 'admin-1',
    mode: 'register',
    businessIdentity,
  });

  expect(result).toEqual({
    allowed: true,
    limit: null,
    storeNumber: 'STORE-002',
    posNo: 'POS-01',
    touchpointId: 'TP-01',
  });
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO branch_devices'))).toBe(true);
});

test('device validation remains compatible before branches is_active migration is applied', async () => {
  const missingColumn = new Error('column "is_active" does not exist');
  missingColumn.code = '42703';
  const pool = {
    query: jest.fn()
      .mockRejectedValueOnce(missingColumn)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'branch-a', store_number: null, subscription_plan: 'basic', max_devices_allowed: 1, is_active: true }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'device-row-1', is_active: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
  };

  await expect(ensureDeviceRegistration({
    tenantPool: pool,
    branchId: 'branch-a',
    deviceId: 'device-1',
    userId: 'user-1',
    mode: 'validate',
  })).resolves.toEqual({
    allowed: true,
    limit: 1,
    storeNumber: '',
    posNo: '',
    touchpointId: '',
  });
  expect(pool.query).toHaveBeenCalledTimes(5);
  expect(pool.query.mock.calls[1][0]).toContain('TRUE AS is_active');
});

test('trusted device resolution fails closed when legacy data has multiple active branch registrations', async () => {
  const ambiguousPool = poolWith(async () => ({
    rowCount: 2,
    rows: [
      { id: 2, device_id: 'device-1', branch_id: 'branch-b', is_active: true },
      { id: 1, device_id: 'device-1', branch_id: 'branch-a', is_active: true },
    ],
  }));

  await expect(resolveDevice(ambiguousPool, 'device-1', { requireActive: true })).resolves.toBeNull();

  const reassignedPool = poolWith(async () => ({
    rowCount: 2,
    rows: [
      { id: 2, device_id: 'device-1', branch_id: 'branch-b', is_active: true },
      { id: 1, device_id: 'device-1', branch_id: 'branch-a', is_active: false },
    ],
  }));

  await expect(resolveDevice(reassignedPool, 'device-1', { requireActive: true })).resolves.toEqual({
    id: '2',
    deviceId: 'device-1',
    branchId: 'branch-b',
    active: true,
  });
});
