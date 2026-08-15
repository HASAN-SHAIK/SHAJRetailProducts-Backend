jest.mock('../utils/branchDeviceLicensing', () => ({
  ensureDeviceRegistration: jest.fn(),
  sanitizeDeviceContext: jest.fn(),
}));

jest.mock('../utils/responses', () => ({
  jsonError: jest.fn((res, status, code, message) => {
    res.statusCode = status;
    res.body = { code, message };
    return res;
  }),
}));

const { ensureDeviceRegistration, sanitizeDeviceContext } = require('../utils/branchDeviceLicensing');
const { branchDeviceGuard } = require('./branchDeviceGuard');

beforeEach(() => {
  jest.clearAllMocks();
  sanitizeDeviceContext.mockReturnValue({ deviceId: 'device-1', deviceInfo: { device_name: 'POS 1' } });
});

const tenantRequest = () => ({
  user: { type: 'tenant', user_id: 'user-1' },
  headers: { 'x-branch-id': 'branch-a' },
  tenantPool: {},
});

test('ordinary tenant request validates an existing device without registering or reactivating it', async () => {
  ensureDeviceRegistration.mockResolvedValue({ allowed: true, limit: 2 });
  const next = jest.fn();
  const res = {};

  await branchDeviceGuard(tenantRequest(), res, next);

  expect(ensureDeviceRegistration).toHaveBeenCalledWith(expect.objectContaining({
    branchId: 'branch-a',
    deviceId: 'device-1',
    userId: 'user-1',
    mode: 'validate',
  }));
  expect(next).toHaveBeenCalledTimes(1);
});

test('unregistered device is rejected instead of being auto-created by browser middleware', async () => {
  ensureDeviceRegistration.mockResolvedValue({ allowed: false, code: 'DEVICE_NOT_REGISTERED', limit: 2 });
  const next = jest.fn();
  const res = {};

  await branchDeviceGuard(tenantRequest(), res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(403);
  expect(res.body).toEqual(expect.objectContaining({ code: 'DEVICE_NOT_ALLOWED' }));
  expect(ensureDeviceRegistration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'validate' }));
});

test('inactive device is rejected instead of being silently reactivated', async () => {
  ensureDeviceRegistration.mockResolvedValue({ allowed: false, code: 'DEVICE_INACTIVE', limit: 2 });
  const next = jest.fn();
  const res = {};

  await branchDeviceGuard(tenantRequest(), res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(403);
  expect(ensureDeviceRegistration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'validate' }));
});
