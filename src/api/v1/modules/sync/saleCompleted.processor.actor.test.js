const { processSaleCompleted } = require('./saleCompleted.processor');

const baseEvent = () => ({
  event_id: 'evt-actor-1',
  aggregate_id: 'ord-actor-1',
  payload: {
    actor: {
      user_id: 'user-42',
      role: 'cashier',
      tenant_id: 'tenant-1',
      branch_id: 'store-1',
    },
    order: {
      id: 'ord-actor-1',
      client_order_id: 'client-order-actor-1',
      store_id: 'store-1',
      terminal_id: 'terminal-1',
      status: 'confirmed',
      currency: 'INR',
      subtotal_minor: 1000,
      discount_minor: 0,
      tax_minor: 0,
      total_minor: 1000,
      version: 2,
      created_at: '2026-08-08T10:00:00Z',
      updated_at: '2026-08-08T10:01:00Z',
      completed_at: '2026-08-08T10:01:00Z',
      items: [{
        id: 'itm-actor-1',
        line_no: 1,
        product_id: '1',
        product_name: 'Test Item',
        quantity_milli: 1000,
        unit_price_minor: 1000,
        discount_minor: 0,
        tax_minor: 0,
        line_total_minor: 1000,
      }],
    },
    receipt: {
      id: 'rcpt-actor-1',
      receipt_number: 'R-ACTOR-1',
      document_type: 'sale',
      store_id: 'store-1',
      terminal_id: 'terminal-1',
      currency: 'INR',
      total_minor: 1000,
      paid_minor: 1000,
      balance_minor: 0,
      snapshot: {},
      snapshot_sha256: 'abc123',
      issued_at: '2026-08-08T10:01:00Z',
    },
    payments: [],
    inventory_movements: [],
  },
});

const client = () => ({
  query: jest.fn(async (sql) => {
    const statement = String(sql);
    if (statement.includes('INSERT INTO orders(')) {
      return { rowCount: 1, rows: [{ id: 501, source_version: 2 }] };
    }
    return { rowCount: 1, rows: [] };
  }),
});

describe('sale.completed cashier audit projection', () => {
  test('uses verified payload actor as canonical source audit identity', async () => {
    const db = client();
    const result = await processSaleCompleted(db, baseEvent());

    const orderCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders('));
    expect(orderCall).toBeTruthy();
    expect(orderCall[1][20]).toBe('user-42');
    expect(orderCall[1][21]).toBe('user-42');
    expect(result).toMatchObject({ central_order_id: 501, canonical_applied: true, cashier_user_id: 'user-42' });
  });

  test('explicit order audit fields override actor fallback', async () => {
    const db = client();
    const event = baseEvent();
    event.payload.order.created_by_user_id = 'user-created';
    event.payload.order.completed_by_user_id = 'user-completed';

    await processSaleCompleted(db, event);

    const orderCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders('));
    expect(orderCall[1][20]).toBe('user-created');
    expect(orderCall[1][21]).toBe('user-completed');
  });

  test('older events without actor remain compatible', async () => {
    const db = client();
    const event = baseEvent();
    delete event.payload.actor;

    const result = await processSaleCompleted(db, event);

    const orderCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders('));
    expect(orderCall[1][20]).toBeNull();
    expect(orderCall[1][21]).toBeNull();
    expect(result.cashier_user_id).toBeNull();
  });
});
