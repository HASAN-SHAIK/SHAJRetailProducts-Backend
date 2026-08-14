const mockResolveDevice = jest.fn();

jest.mock('../../../../configuration/targets', () => ({
  resolveDevice: mockResolveDevice,
}));

const { resolvePosInventoryDeviceContext } = require('./posInventoryDeviceContext');

describe('resolvePosInventoryDeviceContext', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the active Central registration and branch as trusted inventory context', async () => {
    const pool = { query: jest.fn() };
    mockResolveDevice.mockResolvedValue({
      id: 'registration-1',
      deviceId: 'device-1',
      branchId: '11111111-1111-1111-1111-111111111111',
      active: true,
    });

    await expect(resolvePosInventoryDeviceContext(pool, 'device-1')).resolves.toEqual({
      requestedDeviceId: 'device-1',
      deviceId: 'device-1',
      registrationId: 'registration-1',
      branchId: '11111111-1111-1111-1111-111111111111',
    });
    expect(mockResolveDevice).toHaveBeenCalledWith(pool, 'device-1', { requireActive: true });
  });

  test.each([
    ['missing registration', null],
    ['registration without branch', { id: 'registration-1', deviceId: 'device-1', branchId: null, active: true }],
  ])('rejects %s for inventory synchronization', async (_label, resolvedDevice) => {
    mockResolveDevice.mockResolvedValue(resolvedDevice);

    await expect(resolvePosInventoryDeviceContext({}, 'device-1')).rejects.toMatchObject({
      code: 'POS_SYNC_DEVICE_NOT_REGISTERED',
    });
  });

  test('rejects a missing device identity before resolution', async () => {
    await expect(resolvePosInventoryDeviceContext({}, '   ')).rejects.toMatchObject({
      code: 'POS_SYNC_DEVICE_NOT_REGISTERED',
    });
    expect(mockResolveDevice).not.toHaveBeenCalled();
  });
});
