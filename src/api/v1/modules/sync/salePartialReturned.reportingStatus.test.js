const { processSalePartialReturned } = require('./salePartialReturned.processor');

const partialReturnEvent = () => ({
  event_id: 'evt-partial-return-reporting-1',
  aggregate_type: 'sales_order',
  aggregate_id: 'ord-partial-return-reporting-1',
  aggregate_version: 5,
  schema_version: 1,
  payload: {
    return_id: 'return-partial-reporting-1',
    refund_minor: 25000,
    refunded_by_user_id: 'cashier-1',
    approved_by_user_id: 'manager-1',
    approval_reason: 'Damaged',
    returned_at: '2026-08-21T09:00:00Z',
    order: {
      id: 'ord-partial-return-reporting-1',
      status: 'completed',
      version: 5,
      updated_at: '2026-08-21T09:00:00Z',
    },
    lines: [
      {
        order_item_id: 'item-partial-return-reporting-1',
        quantity_milli: 1000,
        refund_minor: 25000,
      },
    ],
  },
});

describe('sale.partial_returned reporting status projection', () => {
  test('marks canonical orders partially_returned so net revenue reports include them', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM orders') && statement.includes("source_channel='pos'")) {
          return { rowCount: 1, rows: [{ id: 701, source_version: 3 }] };
        }
        if (statement.includes('FROM pos_partial_returns')) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 1, rows: [{ id: 1 }] };
      }),
    };

    await processSalePartialReturned(client, partialReturnEvent());

    const orderUpdate = client.query.mock.calls.find(([sql]) => String(sql).includes('order_status=CASE'));
    expect(orderUpdate).toBeDefined();
    expect(String(orderUpdate[0])).toContain("ELSE 'partially_returned'");
    expect(String(orderUpdate[0])).toContain("THEN 'fully_returned'");
  });
});

