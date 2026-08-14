jest.mock('../../../../configuration/targets', () => ({
  resolveDevice: jest.fn(),
}));

const { resolveDevice } = require('../../../../configuration/targets');
const { resolvePosCatalogDeviceContext } = require('./posCatalogDeviceContext');

describe('V1 POS catalog device context', () => {
  beforeEach(() => resolveDevice.mockReset());

  test('uses the active Central device registration as branch authority', async () => {
    resolveDevice.mockResolvedValue({
      id: 'registration-1',
      deviceId: 'device-e2e',
      branchId: '11111111-1111-1111-1111-111111111111',
      active: true,
    });

    const pool = { query: jest.fn() };
    await expect(resolvePosCatalogDeviceContext(pool, 'device-e2e')).resolves.toEqual({
      requestedDeviceId: 'device-e2e',
      deviceId: 'device-e2e',
      registrationId: 'registration-1',
      branchId: '11111111-1111-1111-1111-111111111111',
    });
    expect(resolveDevice).toHaveBeenCalledWith(pool, 'device-e2e', { requireActive: true });
  });

  test('fails closed when the device is not actively registered to a branch', async () => {
    resolveDevice.mockResolvedValue(null);
    await expect(resolvePosCatalogDeviceContext({}, 'unknown-device')).rejects.toMatchObject({
      code: 'POS_SYNC_DEVICE_NOT_REGISTERED',
    });
  });
});
