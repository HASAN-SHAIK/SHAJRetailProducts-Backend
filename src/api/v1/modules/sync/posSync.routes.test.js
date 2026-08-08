const express = require('express');
const request = require('supertest');

const mockTenantPool = { connect: jest.fn() };
const mockGetPosChanges = jest.fn();

jest.mock('../../../../config/tenantDbResolver', () => ({
  resolveTenantContext: jest.fn(async (tenantId) => ({
    tenant: { id: tenantId, is_active: true },
    tenantPool: mockTenantPool,
    planFeatures: {},
  })),
}));

jest.mock('../../../../services/posSyncGateway', () => ({
  getPosChanges: mockGetPosChanges,
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
  payload: {
    order: {
      id: 'ord-1', client_order_id: 'client-order-1', store_id: 'store-1', terminal_id: 'terminal-1',
      status: 'confirmed', currency: 'INR', subtotal_minor: 12500, discount_minor: 0, tax_minor: 0,
      total_minor: 12500, version: 2, completed_at: '2026-08-07T10:00:00Z',
      created_at: '2026-08-07T09:59:00Z', updated_at: '2026-08-07T10:00:00Z',
      items: [{
        id: 'itm-1', line_no: 1, product_id: 'product-1', product_name: 'Milk', quantity_milli: 1000,
        unit_price_minor: 12500, discount_minor: 0, tax_minor: 0, line_total_minor: 12500,
      }],
    },
    receipt: {
      id: 'rcpt-1', receipt_number: 'R-1', document_type: 'sale', store_id: 'store-1', terminal_id: 'terminal-1',
      currency: 'INR', total_minor: 12500, paid_minor: 12500, balance_minor: 0,
      snapshot: { order_id: 'ord-1' }, snapshot_sha256: 'abc123', issued_at: '2026-08-07T10:00:00Z',
    },
    payments: [{
      id: 'pay-1', client_payment_id: 'client-payment-1', mode: 'cash', direction: 'in', amount_minor: 12500,
      currency: 'INR', status: 'captured', created_at: '2026-08-07T10:00:00Z',
    }],
    inventory_movements: [{
      id: 'mov-1', store_id: 'store-1', product_id: 'product-1', movement_type: 'sale', quantity_delta_milli: -1000,
      reference_type: 'sale_order', reference_id: 'ord-1', order_item_id: 'itm-1', balance_after_milli: 9000,
      occurred_at: '2026-08-07T10:00:00Z',
    }],
  },
  metadata: { source: 'pos_service' },
  created_at: '2026-08-07T10:00:00Z',
};

const authHeaders = {
  'X-POS-Tenant-ID': 'tenant-1',
  'X-POS-Device-ID': 'device-1',
  'X-POS-Sync-Token': 'sync-secret',
  'Idempotency-Key': 'evt-1',
};

const successfulClient = () => ({
  query: jest.fn(async (sql) => {
    const statement = String(sql);
    if (statement.includes('INSERT INTO pos_sync_events')) {
      return { rowCount: 1, rows: [{ event_id: 'evt-1' }] };
    }
    if (statement.includes('INSERT INTO orders(')) {
      return { rowCount: 1, rows: [{ id: 101, source_version: 2 }] };
    }
    return { rowCount: 1, rows: [] };
  }),
  release: jest.fn(),
});

describe('POS central sync ingestion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPosChanges.mockReset();
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
    const response = await request(buildApp()).post('/api/v1/sync/events').send(envelope);
    expect(response.status).toBe(401);
    expect(mockTenantPool.connect).not.toHaveBeenCalled();
  });

  test('atomically persists and projects a completed sale', async () => {
    const client = successfulClient();
    mockTenantPool.connect.mockResolvedValue(client);

    const response = await request(buildApp()).post('/api/v1/sync/events').set(authHeaders).send(envelope);

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('accepted');
    expect(response.body.event_id).toBe('evt-1');
    expect(response.body.projection).toMatchObject({
      order_id: 'ord-1', central_order_id: 101, canonical_applied: true,
      items: 1, payments: 1, inventory_movements: 1, receipt_id: 'rcpt-1',
    });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO orders('))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM order_items'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO order_items('))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_sales'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_sale_items'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_sale_payments'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_sale_receipts'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_inventory_movements'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('processed_at=NOW()'))).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('returns conflict without re-projecting when the event id is replayed', async () => {
    const client = successfulClient();
    client.query.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO pos_sync_events')) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    mockTenantPool.connect.mockResolvedValue(client);

    const response = await request(buildApp()).post('/api/v1/sync/events').set(authHeaders).send(envelope);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SYNC_EVENT_ALREADY_RECEIVED');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO orders('))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO pos_sales'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back the event when sale payload projection is invalid', async () => {
    const client = successfulClient();
    mockTenantPool.connect.mockResolvedValue(client);
    const invalid = JSON.parse(JSON.stringify(envelope));
    delete invalid.payload.receipt;

    const response = await request(buildApp()).post('/api/v1/sync/events').set(authHeaders).send(invalid);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_SALE_COMPLETED_PAYLOAD');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('returns change feed records for an authenticated POS device', async () => {
    mockGetPosChanges.mockResolvedValue({
      cursor: 'next-cursor',
      has_more: false,
      changes: [
        { type: 'catalog.product.upsert' },
        { type: 'catalog.barcode.upsert' },
        { type: 'catalog.price.upsert' },
      ],
    });

    const response = await request(buildApp())
      .get('/api/v1/sync/changes?limit=1')
      .set(authHeaders);

    expect(response.status).toBe(200);
    expect(mockGetPosChanges).toHaveBeenCalledWith({
      tenantPool: mockTenantPool,
      cursorValue: undefined,
      limit: '1',
    });
    expect(response.body.has_more).toBe(false);
    expect(response.body.cursor).toBeTruthy();
    expect(response.body.changes.map((change) => change.type)).toEqual([
      'catalog.product.upsert',
      'catalog.barcode.upsert',
      'catalog.price.upsert',
    ]);
  });
});
