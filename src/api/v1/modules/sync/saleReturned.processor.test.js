const { processSaleReturned } = require('./saleReturned.processor');

describe('sale.returned projection', () => {
  const event = {
    event_id: 'evt-return-1',
    event_type: 'sale.returned',
    schema_version: 1,
    aggregate_type: 'sales_order',
    aggregate_id: 'ord-1',
    aggregate_version: 3,
    payload: {
      order: {
        id: 'ord-1',
        status: 'returned',
        version: 3,
        approved_by_user_id: 'manager-1',
        approval_reason: 'customer returned all items',
        updated_at: '2026-08-09T00:00:00Z',
      },
      payments: [],
      inventory_movements: [],
    },
  };

  test('advances an existing canonical POS sale to returned and preserves refund audit', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 3 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const result = await processSaleReturned(client, event);

    expect(result).toEqual({ order_id: 'ord-1', central_order_id: 42, canonical_applied: true, status: 'returned' });
    expect(String(client.query.mock.calls[0][0])).toContain("order_status='returned'");
    expect(String(client.query.mock.calls[0][0])).toContain('source_refund_approved_by_user_id');
    expect(String(client.query.mock.calls[0][0])).toContain('total_paid=0');
    expect(client.query.mock.calls[0][1]).toEqual([
      'ord-1',
      'evt-return-1',
      3,
      'manager-1',
      'customer returned all items',
      '2026-08-09T00:00:00Z',
    ]);
  });

  test('treats an older replay as non-applied when a newer canonical version already exists', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 4 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };

    await expect(processSaleReturned(client, event)).resolves.toMatchObject({
      central_order_id: 42,
      canonical_applied: false,
      status: 'returned',
    });
  });

  test('fails retryably when the parent completed sale has not been projected', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };

    await expect(processSaleReturned(client, event)).rejects.toMatchObject({
      code: 'SALE_RETURNED_PARENT_MISSING',
    });
  });

  test('rejects mismatched aggregate/version/status contracts', async () => {
    const client = { query: jest.fn() };

    await expect(processSaleReturned(client, { ...event, aggregate_id: 'other' })).rejects.toMatchObject({
      code: 'INVALID_SALE_RETURNED_PAYLOAD',
    });
    await expect(processSaleReturned(client, { ...event, aggregate_version: 4 })).rejects.toMatchObject({
      code: 'INVALID_SALE_RETURNED_PAYLOAD',
    });
    await expect(processSaleReturned(client, {
      ...event,
      payload: { ...event.payload, order: { ...event.payload.order, status: 'paid' } },
    })).rejects.toMatchObject({ code: 'INVALID_SALE_RETURNED_PAYLOAD' });
    expect(client.query).not.toHaveBeenCalled();
  });
});
