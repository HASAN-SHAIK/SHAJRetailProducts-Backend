const express = require('express');
const request = require('supertest');

const mockTenantPool = { connect: jest.fn() };
const mockProcessPosEvent = jest.fn();
const mockResolveDevice = jest.fn();

jest.mock('../../../../config/tenantDbResolver', () => ({
  resolveTenantContext: jest.fn(async (tenantId) => ({
    tenant: { id: tenantId, is_active: true },
    tenantPool: mockTenantPool,
    planFeatures: {},
  })),
}));

jest.mock('./posEvent.processor', () => ({ processPosEvent: mockProcessPosEvent }));
jest.mock('./posInventoryDeviceContext', () => ({
  resolvePosInventoryDeviceContext: (...args) => mockResolveDevice(...args),
}));
jest.mock('./posCatalogDeviceContext', () => ({
  resolvePosCatalogDeviceContext: jest.fn(),
}));
jest.mock('../../../../services/posSyncGateway', () => ({ getPosChanges: jest.fn() }));
jest.mock('./posConfig.routes', () => ((req, res, next) => next()));

const router = require('./posSync.routes');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/sync', router);
  app.use((error, req, res, next) => res.status(500).json({ code: error.code, message: error.message }));
  return app;
};

const event = {
  event_id: 'evt-store-device-1',
  event_type: 'payment.recorded',
  schema_version: 1,
  aggregate_type: 'payment',
  aggregate_id: 'pay-1',
  aggregate_version: 1,
  ordering_key: 'payment:pay-1',
  payload: { id: 'pay-1' },
  metadata: { source: 'pos_service' },
  created_at: '2026-08-15T12:00:00Z',
};

const headers = {
  'X-POS-Tenant-ID': 'tenant-1',
  'X-POS-Device-ID': 'device-1',
  'X-POS-Sync-Token': 'sync-secret',
  'Idempotency-Key': event.event_id,
};

const clientWith = ({ inserted = true, exactMatch = false } = {}) => ({
  query: jest.fn(async (sql) => {
    const statement = String(sql);
    if (statement.includes('INSERT INTO pos_sync_events')) {
      return inserted ? { rowCount: 1, rows: [{ event_id: event.event_id }] } : { rowCount: 0, rows: [] };
    }
    if (statement.includes('FROM pos_sync_events') && statement.includes('exact_match')) {
      return { rowCount: 1, rows: [{ exact_match: exactMatch }] };
    }
    return { rowCount: 1, rows: [] };
  }),
  release: jest.fn(),
});

describe('V1 Store/Device sync authority', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POS_SYNC_TENANT_ID = 'tenant-1';
    process.env.POS_SYNC_TOKEN = 'sync-secret';
    delete process.env.POS_SYNC_TOKENS_JSON;
    mockProcessPosEvent.mockResolvedValue({ status: 'projected' });
  });

  afterEach(() => {
    delete process.env.POS_SYNC_TENANT_ID;
    delete process.env.POS_SYNC_TOKEN;
    delete process.env.POS_SYNC_TOKENS_JSON;
  });

  test('requires active Central device registration before projecting every new POS event', async () => {
    const client = clientWith();
    mockTenantPool.connect.mockResolvedValue(client);
    const error = new Error('POS device must be actively registered to a Central branch for synchronization');
    error.code = 'POS_SYNC_DEVICE_NOT_REGISTERED';
    mockResolveDevice.mockRejectedValue(error);

    const response = await request(buildApp()).post('/api/v1/sync/events').set(headers).send(event);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('POS_SYNC_DEVICE_NOT_REGISTERED');
    expect(mockResolveDevice).toHaveBeenCalledWith(client, 'device-1');
    expect(mockProcessPosEvent).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });

  test('projects a new event only after active device authority succeeds', async () => {
    const client = clientWith();
    const device = { requestedDeviceId: 'device-1', deviceId: 'device-1', registrationId: 'registration-1', branchId: 'branch-1' };
    mockTenantPool.connect.mockResolvedValue(client);
    mockResolveDevice.mockResolvedValue(device);

    const response = await request(buildApp()).post('/api/v1/sync/events').set(headers).send(event);

    expect(response.status).toBe(202);
    expect(mockResolveDevice).toHaveBeenCalledWith(client, 'device-1');
    expect(mockProcessPosEvent).toHaveBeenCalledWith(client, expect.objectContaining({ event_id: event.event_id }), { syncDevice: device });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('preserves lost-ack duplicate replay without revalidating a later-revoked device', async () => {
    const client = clientWith({ inserted: false, exactMatch: true });
    mockTenantPool.connect.mockResolvedValue(client);
    mockResolveDevice.mockRejectedValue(Object.assign(new Error('revoked'), { code: 'POS_SYNC_DEVICE_NOT_REGISTERED' }));

    const response = await request(buildApp()).post('/api/v1/sync/events').set(headers).send(event);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'SYNC_EVENT_ALREADY_RECEIVED', event_id: event.event_id });
    expect(mockResolveDevice).not.toHaveBeenCalled();
    expect(mockProcessPosEvent).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
