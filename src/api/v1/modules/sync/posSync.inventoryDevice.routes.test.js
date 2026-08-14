const express = require('express');
const request = require('supertest');

const mockTenantPool = { connect: jest.fn() };
const mockProcessPosEvent = jest.fn();

jest.mock('../../../../config/tenantDbResolver', () => ({
  resolveTenantContext: jest.fn(async (tenantId) => ({
    tenant: { id: tenantId, is_active: true },
    tenantPool: mockTenantPool,
    planFeatures: {},
  })),
}));

jest.mock('./posEvent.processor', () => ({ processPosEvent: mockProcessPosEvent }));

const router = require('./posSync.routes');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/sync', router);
  app.use((error, req, res, next) => res.status(500).json({ code: error.code || 'ERROR', message: error.message }));
  return app;
};

const event = {
  event_id: 'mov-event-1',
  event_type: 'inventory.movement.recorded',
  schema_version: 1,
  aggregate_type: 'inventory_movement',
  aggregate_id: 'mov-1',
  aggregate_version: 1,
  ordering_key: 'inventory:product-101',
  payload: { movement: { id: 'mov-1' } },
  metadata: {},
  created_at: '2026-08-14T00:00:00Z',
};

const headers = {
  'X-POS-Tenant-ID': 'tenant-1',
  'X-POS-Device-ID': 'device-1',
  'X-POS-Sync-Token': 'sync-secret',
  'Idempotency-Key': 'mov-event-1',
};

const clientWithDevice = (deviceRow) => ({
  query: jest.fn(async (sql) => {
    const statement = String(sql);
    if (statement.includes('FROM branch_devices')) {
      return deviceRow ? { rowCount: 1, rows: [deviceRow] } : { rowCount: 0, rows: [] };
    }
    if (statement.includes('INSERT INTO pos_sync_events')) return { rowCount: 1, rows: [{ event_id: 'mov-event-1' }] };
    return { rowCount: 1, rows: [] };
  }),
  release: jest.fn(),
});

describe('POS inventory sync device authority', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POS_SYNC_TENANT_ID = 'tenant-1';
    process.env.POS_SYNC_TOKEN = 'sync-secret';
    mockProcessPosEvent.mockResolvedValue({ movement_id: 'mov-1' });
  });

  afterEach(() => {
    delete process.env.POS_SYNC_TENANT_ID;
    delete process.env.POS_SYNC_TOKEN;
  });

  test('passes an active Central-registered branch context into inventory projection', async () => {
    const client = clientWithDevice({
      id: 'registration-1', device_id: 'device-1', branch_id: '11111111-1111-1111-1111-111111111111', is_active: true,
    });
    mockTenantPool.connect.mockResolvedValue(client);

    const response = await request(buildApp()).post('/api/v1/sync/events').set(headers).send(event);

    expect(response.status).toBe(202);
    expect(mockProcessPosEvent).toHaveBeenCalledWith(client, expect.objectContaining({ event_id: 'mov-event-1' }), {
      inventoryDevice: {
        requestedDeviceId: 'device-1',
        deviceId: 'device-1',
        registrationId: 'registration-1',
        branchId: '11111111-1111-1111-1111-111111111111',
      },
    });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rejects inventory projection from an unregistered device before the event is persisted', async () => {
    const client = clientWithDevice(null);
    mockTenantPool.connect.mockResolvedValue(client);

    const response = await request(buildApp()).post('/api/v1/sync/events').set(headers).send(event);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('POS_SYNC_DEVICE_NOT_REGISTERED');
    expect(mockProcessPosEvent).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_sync_events'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
