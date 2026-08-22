const { processSaleCompleted } = require('./saleCompleted.processor');

const paidSaleEvent = () => ({
  event_id: 'evt-paid-sale-reporting-1',
  aggregate_id: 'ord-paid-sale-reporting-1',
  payload: {
    order: {
      id: 'ord-paid-sale-reporting-1',
      client_order_id: 'client-paid-sale-reporting-1',
      store_id: 'store-1',
      terminal_id: 'terminal-1',
      customer_id: null,
      status: 'paid',
      currency: 'INR',
      subtotal_minor: 25000,
      discount_minor: 0,
      tax_minor: 0,
      total_minor: 25000,
      version: 3,
      completed_at: '2026-08-21T08:39:01Z',
      created_at: '2026-08-21T08:39:00Z',
      updated_at: '2026-08-21T08:39:01Z',
      items: [
        {
          id: 'item-paid-sale-reporting-1',
          line_no: 1,
          product_id: '101',
          product_name: 'Reportable Item',
          quantity_milli: 1000,
          unit_price_minor: 25000,
          discount_minor: 0,
          tax_minor: 0,
          line_total_minor: 25000,
        },
      ],
    },
    receipt: {
      id: 'receipt-paid-sale-reporting-1',
      receipt_number: 'R-PAID-1',
      document_type: 'receipt',
      store_id: 'store-1',
      terminal_id: 'terminal-1',
      customer_id: null,
      currency: 'INR',
      total_minor: 25000,
      paid_minor: 25000,
      balance_minor: 0,
      snapshot: {},
      snapshot_sha256: 'paid-sale-reporting-sha',
      issued_at: '2026-08-21T08:39:01Z',
    },
    payments: [],
    inventory_movements: [],
  },
});

describe('sale.completed reporting status projection', () => {
  test('normalizes POS paid orders to completed so reports count sales and revenue', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const statement = String(sql);
        if (statement.includes('INSERT INTO orders(')) {
          return { rowCount: 1, rows: [{ id: 601, source_version: 3 }] };
        }
        return { rowCount: 1, rows: [] };
      }),
    };

    await processSaleCompleted(client, paidSaleEvent());

    const orderInsert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO orders('));
    expect(orderInsert).toBeDefined();
    expect(orderInsert[1][4]).toBe('completed');
  });
});

