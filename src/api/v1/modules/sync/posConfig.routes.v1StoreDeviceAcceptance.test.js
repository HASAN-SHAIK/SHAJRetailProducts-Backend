const express = require('express');
const request = require('supertest');

const mockResolveTenantContext = jest.fn();
const mockResolveEffectiveConfiguration = jest.fn();

jest.mock('../../../../config/tenantDbResolver', () => ({
  resolveTenantContext: (...args) => mockResolveTenantContext(...args),
}));

jest.mock('../../../../configuration/service', () => ({
  resolveEffectiveConfiguration: (...args) => mockResolveEffectiveConfiguration(...args),
}));

const posConfigRouter = require('./posConfig.routes');

const buildApp = () => {
  const app = express();
  app.use('/sync/config', posConfigRouter);
  return app;
};

const machineHeaders = {
  'X-POS-Tenant-ID': 'tenant-a',
  'X-POS-Device-ID': 'device-a',
  'X-POS-Sync-Token': 'sync-token-a',
};

describe('V1 Store/Device revoked-device configuration reconnect authority', () => {
  const originalTokens = process.env.POS_SYNC_TOKENS_JSON;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POS_SYNC_TOKENS_JSON = JSON.stringify({ 'tenant-a': 'sync-token-a' });
    mockResolveTenantContext.mockResolvedValue({
      tenant: { id: 'tenant-a', is_active: true },
      tenantPool: { query: jest.fn() },
      planFeatures: {},
    });
  });

  afterAll(() => {
    if (originalTokens === undefined) delete process.env.POS_SYNC_TOKENS_JSON;
    else process.env.POS_SYNC_TOKENS_JSON = originalTokens;
  });

  test('requires the production POS config route to resolve an actively registered device', async () => {
    mockResolveEffectiveConfiguration.mockResolvedValue({
      schema_version: 1,
      etag: 'etag-active',
      scope: { tenant_id: 'tenant-a', branch_id: 'branch-a', device_id: 'device-a' },
      values: {},
      config: {},
      sources: {},
    });

    const response = await request(buildApp())
      .get('/sync/config/effective')
      .set(machineHeaders)
      .expect(200);

    expect(response.headers.etag).toBe('"etag-active"');
    expect(mockResolveEffectiveConfiguration).toHaveBeenCalledTimes(1);
    const [req, options] = mockResolveEffectiveConfiguration.mock.calls[0];
    expect(req.posDeviceId).toBe('device-a');
    expect(options).toEqual({ deviceId: 'device-a', requireRegisteredDevice: true });
  });

  test('returns the Central revoked-device 403 and does not fall back to unregistered configuration', async () => {
    const revoked = new Error('POS device is not actively registered');
    revoked.status = 403;
    revoked.code = 'POS_DEVICE_NOT_REGISTERED';
    mockResolveEffectiveConfiguration.mockRejectedValue(revoked);

    const response = await request(buildApp())
      .get('/sync/config/effective')
      .set(machineHeaders)
      .expect(403);

    expect(response.body).toEqual({
      code: 'POS_DEVICE_NOT_REGISTERED',
      message: 'POS device is not actively registered',
    });
    expect(mockResolveEffectiveConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ posDeviceId: 'device-a' }),
      { deviceId: 'device-a', requireRegisteredDevice: true }
    );
  });

  test('rejects reconnect before configuration resolution when machine credentials are invalid', async () => {
    await request(buildApp())
      .get('/sync/config/effective')
      .set({ ...machineHeaders, 'X-POS-Sync-Token': 'wrong-token' })
      .expect(401);

    expect(mockResolveEffectiveConfiguration).not.toHaveBeenCalled();
  });
});
