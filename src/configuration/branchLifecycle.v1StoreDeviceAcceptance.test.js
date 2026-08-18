const { ensureDeviceRegistration } = require('../utils/branchDeviceLicensing');
const { resolveBranch, resolveDevice } = require('./targets');

test('inactive branch rejects new or reactivated POS device authority', async () => {
  const tenantPool = {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM branches')) {
        return { rows: [{ id: 'branch-a', subscription_plan: 'basic', max_devices_allowed: 1, is_active: false }], rowCount: 1 };
      }
      throw new Error(`unexpected SQL after inactive branch policy: ${sql}`);
    }),
  };

  await expect(ensureDeviceRegistration({
    tenantPool,
    branchId: 'branch-a',
    deviceId: 'device-a',
    mode: 'register',
  })).resolves.toEqual({ allowed: false, code: 'BRANCH_INACTIVE' });
});

test('inactive branch makes an otherwise active device unusable for trusted POS configuration', async () => {
  const requestPool = {
    query: jest.fn(async () => ({
      rows: [{
        id: 1,
        device_id: 'device-a',
        branch_id: 'branch-a',
        is_active: true,
        branch_is_active: false,
      }],
      rowCount: 1,
    })),
  };

  await expect(resolveDevice(requestPool, 'device-a', { requireActive: true })).resolves.toBeNull();
});

test('device resolution remains compatible before branches is_active migration is applied', async () => {
  const missingColumn = new Error('column b.is_active does not exist');
  missingColumn.code = '42703';
  const requestPool = {
    query: jest.fn()
      .mockRejectedValueOnce(missingColumn)
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          device_id: 'device-a',
          branch_id: 'branch-a',
          is_active: true,
          branch_is_active: true,
        }],
        rowCount: 1,
      }),
  };

  await expect(resolveDevice(requestPool, 'device-a', { requireActive: true })).resolves.toMatchObject({
    id: '1',
    deviceId: 'device-a',
    branchId: 'branch-a',
    active: true,
  });
  expect(requestPool.query).toHaveBeenCalledTimes(2);
  expect(requestPool.query.mock.calls[1][0]).toContain('TRUE AS branch_is_active');
});

test('branch resolution remains compatible before branches is_active migration is applied', async () => {
  const missingColumn = new Error('column "is_active" does not exist');
  missingColumn.code = '42703';
  const requestPool = {
    query: jest.fn()
      .mockRejectedValueOnce(missingColumn)
      .mockResolvedValueOnce({ rows: [{ id: 'branch-a' }], rowCount: 1 }),
  };

  await expect(resolveBranch(requestPool, 'branch-a')).resolves.toBe('branch-a');
  expect(requestPool.query).toHaveBeenCalledTimes(2);
  expect(requestPool.query.mock.calls[1][0]).not.toContain('is_active = TRUE');
});
