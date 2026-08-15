const { ensureDeviceRegistration } = require('./branchDeviceLicensing');
const { resolveDevice } = require('../configuration/targets');

const poolWith = (handler) => ({ query: jest.fn(handler) });

beforeEach(() => {
  jest.clearAllMocks();
});

test('active device cannot be registered on a second branch until the old registration is deactivated', async () => {
  const pool = poolWith(async (sql, params) => {
    if (sql.includes('FROM branches')) {
      return { rowCount: 1, rows: [{ id: 'branch-b', subscription_plan: 'enterprise', max_devices_allowed: null }] };
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
      return { rowCount: 1, rows: [{ id: 'branch-b', subscription_plan: 'enterprise', max_devices_allowed: null }] };
    }
    if (sql.includes('branch_id <> $2') && sql.includes('is_active = TRUE')) {
      expect(params).toEqual(['device-1', 'branch-b']);
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('WHERE branch_id = $1 AND device_id = $2')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('INSERT INTO branch_devices')) {
      expect(params[0]).toBe('branch-b');
      expect(params[2]).toBe('device-1');
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
  });

  expect(result).toEqual({ allowed: true, limit: null });
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO branch_devices'))).toBe(true);
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
