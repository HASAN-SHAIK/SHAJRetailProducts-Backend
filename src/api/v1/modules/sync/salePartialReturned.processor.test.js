const { processSalePartialReturned } = require('./salePartialReturned.processor');

describe('sale.partial_returned projection', () => {
  const event = {
    event_id: 'evt-partial-return-1',
    event_type: 'sale.partial_returned',
    schema_version: 1,
    aggregate_type: 'sales_order',
    aggregate_id: 'ord-1',
    aggregate_version: 4,
    payload: {
      return_id: 'ret-1',
      refund_minor: 2500,
      refunded_by_user_id: 'cashier-1',
      approved_by_user_id: 'manager-1',
      approval_reason: 'customer returned one item',
      returned_at: '2026-08-09T06:00:00Z',
      order: {
        id: 'ord-1',
        status: 'completed',
        version: 4,
        updated_at: '2026-08-09T06:00:00Z',
      },
      lines: [
        { order_item_id: 'item-1', quantity_milli: 250, refund_minor: 2500 },
      ],
    },
  };

  test('records one partial-return operation with distinct refund initiator and approver', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 3 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await expect(processSalePartialReturned(client, event)).resolves.toEqual({
      return_id: 'ret-1',
      order_id: 'ord-1',
      central_order_id: 42,
      canonical_applied: true,
      replayed: false,
      status: 'completed',
    });

    const insertSql = String(client.query.mock.calls[2][0]);
    expect(insertSql).toContain('refunded_by_user_id');
    expect(insertSql).toContain('approved_by_user_id');
    expect(client.query.mock.calls[2][1]).toEqual([
      'ret-1', 42, 'ord-1', 4, 2500, 'cashier-1', 'manager-1',
      'customer returned one item', 'evt-partial-return-1', '2026-08-09T06:00:00Z',
    ]);
    expect(String(client.query.mock.calls[3][0])).toContain('source_returned_quantity_milli=source_returned_quantity_milli+$3');
    expect(client.query.mock.calls[3][1]).toEqual([42, 'item-1', 250, 2500]);
    const orderSql = String(client.query.mock.calls[5][0]);
    expect(orderSql).toContain('total_paid=GREATEST(0,total_paid-($2::numeric / 100.0))');
    expect(orderSql).toContain('returned_amount=LEAST(total_price,COALESCE(returned_amount,0)+($2::numeric / 100.0))');
    expect(orderSql).toContain('source_version=GREATEST');
  });

  test('treats the same return_id and facts as semantic replay without applying money or quantity twice', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 4 }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            source_order_id: 'ord-1', source_version: 4, refund_minor: 2500,
            refunded_by_user_id: 'cashier-1', approved_by_user_id: 'manager-1', reason: 'customer returned one item',
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ source_item_id: 'item-1', quantity_milli: 250, refund_minor: 2500 }],
        }),
    };

    await expect(processSalePartialReturned(client, { ...event, event_id: 'evt-replayed-with-new-envelope' })).resolves.toMatchObject({
      canonical_applied: false,
      replayed: true,
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('does not infer a missing legacy initiator from the approver', async () => {
    const legacy = { ...event, payload: { ...event.payload } };
    delete legacy.payload.refunded_by_user_id;
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 3 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await processSalePartialReturned(client, legacy);
    expect(client.query.mock.calls[2][1][5]).toBeNull();
    expect(client.query.mock.calls[2][1][6]).toBe('manager-1');
  });

  test('fails closed when a return_id is reused with different actor facts', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 4 }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            source_order_id: 'ord-1', source_version: 4, refund_minor: 2500,
            refunded_by_user_id: 'different-cashier', approved_by_user_id: 'manager-1', reason: 'customer returned one item',
          }],
        }),
    };

    await expect(processSalePartialReturned(client, event)).rejects.toMatchObject({
      code: 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD',
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('fails retryably when the completed parent sale has not reached Central', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }) };
    await expect(processSalePartialReturned(client, event)).rejects.toMatchObject({
      code: 'SALE_PARTIAL_RETURNED_PARENT_MISSING',
    });
  });

  test('rejects aggregate, lifecycle, line-total, duplicate-line and over-return contracts', async () => {
    const noQuery = { query: jest.fn() };
    await expect(processSalePartialReturned(noQuery, { ...event, aggregate_id: 'other' })).rejects.toMatchObject({
      code: 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD',
    });
    await expect(processSalePartialReturned(noQuery, {
      ...event,
      payload: { ...event.payload, order: { ...event.payload.order, status: 'voided' } },
    })).rejects.toMatchObject({ code: 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD' });
    await expect(processSalePartialReturned(noQuery, {
      ...event,
      payload: { ...event.payload, refund_minor: 2499 },
    })).rejects.toMatchObject({ code: 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD' });
    await expect(processSalePartialReturned(noQuery, {
      ...event,
      payload: { ...event.payload, lines: [...event.payload.lines, ...event.payload.lines] },
    })).rejects.toMatchObject({ code: 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD' });
    expect(noQuery.query).not.toHaveBeenCalled();

    const overReturn = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42, source_version: 3 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };
    await expect(processSalePartialReturned(overReturn, event)).rejects.toMatchObject({
      code: 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD',
    });
  });
});