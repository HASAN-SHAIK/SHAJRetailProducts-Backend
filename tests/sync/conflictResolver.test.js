const {
  resolveSyncConflict,
  applyMergeFields,
} = require('../../src/messaging/sync/conflictResolver');
const { RESOLUTION_OUTCOME, CONFLICT_REASON } = require('../../src/messaging/sync/conflictResolutionPolicy');

describe('conflictResolver', () => {
  const makePool = (handlers = {}) => ({
    query: jest.fn(async (sql, params) => {
      if (handlers.query) return handlers.query(sql, params);
      return { rows: [], rowCount: 0 };
    }),
  });

  test('server wins when last modified is newer', async () => {
    const tenantPool = makePool({
      query: async (sql) => {
        if (sql.includes('FROM orders')) {
          return {
            rows: [
              {
                id: 10,
                updated_at: '2026-07-12T12:00:00.000Z',
                is_deleted: false,
                client_order_id: 'client-1',
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const resolution = await resolveSyncConflict({
      tenantPool,
      module: 'sales',
      entityType: 'order',
      action: 'UPDATE',
      payload: {
        client_order_id: 'client-1',
        updated_at: '2026-07-12T11:00:00.000Z',
      },
    });

    expect(resolution.outcome).toBe(RESOLUTION_OUTCOME.SERVER_WINS);
    expect(resolution.reason).toBe(CONFLICT_REASON.LAST_MODIFIED);
  });

  test('skips duplicate sale on CREATE when client_order_id exists', async () => {
    const tenantPool = makePool({
      query: async (sql) => {
        if (sql.includes('FROM orders')) {
          return {
            rows: [{ id: 99, updated_at: '2026-07-12T10:00:00.000Z', is_deleted: false, client_order_id: 'dup-1' }],
          };
        }
        return { rows: [] };
      },
    });

    const resolution = await resolveSyncConflict({
      tenantPool,
      module: 'sales',
      entityType: 'order',
      action: 'CREATE',
      payload: { client_order_id: 'dup-1', transaction_type: 'sale', products: [] },
    });

    expect(resolution.outcome).toBe(RESOLUTION_OUTCOME.SKIP_DUPLICATE);
    expect(resolution.reason).toBe(CONFLICT_REASON.DUPLICATE_SALE);
    expect(resolution.serverEntityId).toBe(99);
  });

  test('blocks apply when inventory protection fails', async () => {
    const tenantPool = makePool({
      query: async (sql, params) => {
        if (sql.includes('FROM products') && sql.includes('ANY')) {
          return {
            rows: [{ id: 5, stock_quantity: 1, is_deleted: false, name: 'Rice' }],
          };
        }
        return { rows: [] };
      },
    });

    const resolution = await resolveSyncConflict({
      tenantPool,
      module: 'sales',
      entityType: 'order',
      action: 'CREATE',
      payload: {
        client_order_id: 'new-sale-1',
        transaction_type: 'sale',
        products: [{ product_id: 5, quantity: 3 }],
      },
    });

    expect(resolution.outcome).toBe(RESOLUTION_OUTCOME.CONFLICT);
    expect(resolution.reason).toBe(CONFLICT_REASON.INVENTORY_PROTECTION);
  });

  test('merge fields when timestamps are equal', () => {
    const merged = applyMergeFields(
      {
        order: {
          payment_mode: 'cash',
          order_status: 'paid',
        },
      },
      { payment_mode: 'credit', order_status: 'pending', total_paid: 100 },
      ['payment_mode', 'order_status']
    );

    expect(merged.order.payment_mode).toBe('cash');
    expect(merged.order.order_status).toBe('paid');
  });
});
