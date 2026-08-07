const express = require('express');
const request = require('supertest');

const tenantPool = { connect: jest.fn() };

jest.mock('../../../../config/tenantDbResolver', () => ({
  resolveTenantContext: jest.fn(async (tenantId) => ({
    tenant: { id: tenantId, is_active: true },
    tenantPool,
    planFeatures: {},
  })),
}));

const router = require('./posSync.routes');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/sync', router);
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  return app;
};

const envelope = {
  event_id: 'evt-1',
  event_type: 'sale.completed',
  schema_version: 1,
  aggregate_type: 'sales_order',
  aggregate_id: 'ord-1',
  aggregate_version: 2,
  ordering_key: 'sales_order:ord-1',
  payload: { order: { id: 'ord-1' } },
  metadata: { source: 'pos_service' },
  created_at: '2026-08-07T10:00:00Z',
};

const authHeaders = {
  'X-POS-Tenant-ID': 'tenant-1',
  'X-POS-Device-ID': 'device-1',
  'X-POS-Sync-Token': 'sync-secret',
  'Idempotency-Key': 'evt-1',
};

describe('POS central sync ingestion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POS_SYNC_TENANT_ID = 'tenant-1';
    process.env.POS_SYNC_TOKEN = 'sync-secret';
    delete process.env.POS_SYNC_TOKENS_JSON;
  });

  afterEach(() => {
    delete process.env.POS_SYNC_TENANT_ID;
    delete process.env.POS_SYNC_TOKEN;
    delete process.env.POS_SYNC_TOKENS_JSON;
  });

  test('rejects requests without machine credentials', async () => {
    const response = await request(buildApp())
      .post('/api/v1/sync/events')
      .send(envelope);

    expect(response.status).toBe(401);
    expect(tenantPool.connect).not.toHaveBeenCalled();
  });

  test('persists a new event once and returns accepted', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('INSERT INTO pos_sync_events')) {
          return { rowCount: 1, rows: [{ event_id: 'evt-1' }] };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    tenantPool.connect.mockResolvedValue(client);

    const response = await request(buildApp())
      .post('/api/v1/sync/events')
      .set(authHeaders)
      .send(envelope);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'accepted', event_id: 'evt-1' });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('returns conflict when the same event id is replayed', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('INSERT INTO pos_sync_events')) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: jest.fn(),
    };
    tenantPool.connect.mockResolvedValue(client);

    const response = await request(buildApp())
      .post('/api/v1/sync/events')
      .set(authHeaders)
      .send(envelope);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SYNC_EVENT_ALREADY_RECEIVED');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
