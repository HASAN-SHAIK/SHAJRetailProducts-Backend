const { processSalePartialReturned } = require('./salePartialReturned.processor');

test('sale.partial_returned accepts returned status for the final item-level operation before sale.returned', async () => {
  const event = {
    event_id: 'evt-final-line-return',
    event_type: 'sale.partial_returned',
    schema_version: 1,
    aggregate_type: 'sales_order',
    aggregate_id: 'ord-1',
    aggregate_version: 5,
    payload: {
      return_id: 'ret-final',
      refund_minor: 7500,
      approved_by_user_id: 'manager-1',
      approval_reason: 'return remaining items',
      order: { id: 'ord-1', status: 'returned', version: 5, updated_at: '2026-08-09T06:30:00Z' },
      lines: [{ order_item_id: 'item-1', quantity_milli: 750, refund_minor: 7500 }],
    },
  };
  const client = {
    query: jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 4 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
  };

  await expect(processSalePartialReturned(client, event)).resolves.toMatchObject({
    canonical_applied: true,
    replayed: false,
    status: 'returned',
  });
});
