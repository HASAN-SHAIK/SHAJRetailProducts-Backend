const { ensureDeviceRegistration } = require('../utils/branchDeviceLicensing');
const { resolveDevice } = require('./targets');

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
