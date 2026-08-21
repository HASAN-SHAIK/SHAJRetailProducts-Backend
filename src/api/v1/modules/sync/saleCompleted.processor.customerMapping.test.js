const { processSaleCompleted } = require('./saleCompleted.processor');

const offlineCustomerSale = () => ({
  event_id: 'evt-offline-customer-sale-1',
  aggregate_id: 'ord-offline-customer-1',
  payload: {
    actor: {
      user_id: 'staff-cashier-1',
      role: 'cashier',
      tenant_id: 'tenant-1',
      branch_id: 'store-1',
    },
    order: {
      id: 'ord-offline-customer-1',
      client_order_id: 'client-offline-customer-1',
      store_id: 'store-1',
      terminal_id: 'terminal-1',
      customer_id: 'cus_offline_abc123',
      created_by_user_id: 'staff-creator-1',
      completed_by_user_id: 'staff-cashier-1',
      status: 'confirmed',
      currency: 'INR',
      subtotal_minor: 1000,
      discount_minor: 0,
      tax_minor: 0,
      total_minor: 1000,
      version: 2,
      completed_at: '2026-08-21T12:01:00Z',
      created_at: '2026-08-21T12:00:00Z',
      updated_at: '2026-08-21T12:01:00Z',
      items: [
        {
          id: 'item-offline-customer-1',
          line_no: 1,
          product_id: '101',
          product_name: 'Mapped Customer Product',
          quantity_milli: 1000,
          unit_price_minor: 1000,
          discount_minor: 0,
          tax_minor: 0,
          line_total_minor: 1000,
        },
      ],
    },
    receipt: {
      id: 'receipt-offline-customer-1',
      receipt_number: 'R-OFFLINE-1',
      document_type: 'sale',
      store_id: 'store-1',
      terminal_id: 'terminal-1',
      customer_id: 'cus_offline_abc123',
      currency: 'INR',
      total_minor: 1000,
      paid_minor: 1000,
      balance_minor: 0,
      snapshot: {
        customer: {
          id: 'cus_offline_abc123',
          name: 'Offline Customer At Sale',
        },
      },
      snapshot_sha256: 'offline-customer-snapshot-sha',
      issued_at: '2026-08-21T12:01:00Z',
    },
    payments: [],
    inventory_movements: [],
  },
});

describe('sale.completed offline customer canonical reconciliation', () => {
  test('uses an existing POS customer mapping while preserving source customer identity', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM pos_customer_mappings')) {
          return { rowCount: 1, rows: [{ canonical_customer_id: 77 }] };
        }
        if (statement.includes('INSERT INTO orders(')) {
          return { rowCount: 1, rows: [{ id: 501, source_version: 2 }] };
        }
        return { rowCount: 1, rows: [] };
      }),
    };

    const result = await processSaleCompleted(client, offlineCustomerSale());

    expect(result.central_order_id).toBe(501);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM pos_customer_mappings'),
      ['cus_offline_abc123']
    );

    const orderInsert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders('));
    expect(orderInsert).toBeDefined();
    expect(orderInsert[1][1]).toBe(77);
    expect(orderInsert[1][10]).toBe('cus_offline_abc123');
  });

  test('keeps an unmapped offline source customer without inventing a canonical relationship', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM pos_customer_mappings')) {
          return { rowCount: 0, rows: [] };
        }
        if (statement.includes('INSERT INTO orders(')) {
          return { rowCount: 1, rows: [{ id: 502, source_version: 2 }] };
        }
        return { rowCount: 1, rows: [] };
      }),
    };

    await processSaleCompleted(client, offlineCustomerSale());

    const orderInsert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders('));
    expect(orderInsert[1][1]).toBeNull();
    expect(orderInsert[1][10]).toBe('cus_offline_abc123');
  });
});
