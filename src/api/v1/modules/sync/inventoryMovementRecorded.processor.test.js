const { processInventoryMovementRecorded } = require('./inventoryMovementRecorded.processor');

const event = {
  event_type: 'inventory.movement.recorded',
  schema_version: 1,
  aggregate_type: 'inventory_movement',
  aggregate_id: 'mov-1',
  aggregate_version: 1,
  payload: {
    movement: {
      id: 'mov-1',
      store_id: 'store-1',
      product_id: '101',
      movement_type: 'sale_issue',
      quantity_delta_milli: -1000,
      reference_type: 'sale_order',
      reference_id: 'ord-1',
      order_item_id: 'itm-1',
      balance_after_milli: 4000,
      occurred_at: '2026-08-07T10:00:00Z',
    },
  },
};

const movementRow = (overrides = {}) => ({
  movement_id: 'mov-1',
  order_id: 'ord-1',
  store_id: 'store-1',
  product_id: '101',
  movement_type: 'sale_issue',
  quantity_delta_milli: '-1000',
  reference_type: 'sale_order',
  reference_id: 'ord-1',
  order_item_id: 'itm-1',
  balance_after_milli: '4000',
  occurred_at: new Date('2026-08-07T10:00:00Z'),
  canonical_applied_at: null,
  ...overrides,
});

describe('inventory.movement.recorded projection', () => {
  test('applies a movement to canonical stock without requiring the sale projection first', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow()] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, stock_quantity: '4.000' }] }),
    };

    const result = await processInventoryMovementRecorded(client, event);

    expect(result).toEqual({
      movement_id: 'mov-1',
      order_id: 'ord-1',
      product_id: '101',
      canonical_applied: true,
      canonical_stock_quantity: '4.000',
    });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FROM pos_sales'))).toBe(false);
    expect(String(client.query.mock.calls[3][0])).toContain('UPDATE products');
    expect(client.query.mock.calls[3][1]).toEqual([-1000, 101]);
  });

  test('applies exactly once when sale.completed already projected the movement ledger row', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow()] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, stock_quantity: '4.000' }] }),
    };

    const result = await processInventoryMovementRecorded(client, event);

    expect(result.canonical_applied).toBe(true);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE products'))).toHaveLength(1);
  });

  test('does not apply canonical stock again when the movement was already applied', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [movementRow({ canonical_applied_at: new Date('2026-08-07T10:01:00Z') })],
        }),
    };

    const result = await processInventoryMovementRecorded(client, event);

    expect(result).toMatchObject({ canonical_applied: false, already_applied: true });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE products'))).toBe(false);
  });

  test('fails closed when the same movement id is bound to different immutable facts', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow({ quantity_delta_milli: '-2000' })] }),
    };

    await expect(processInventoryMovementRecorded(client, event)).rejects.toMatchObject({
      code: 'INVALID_INVENTORY_MOVEMENT_PAYLOAD',
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('fails retryably when the canonical Central product is missing', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow()] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
    };

    await expect(processInventoryMovementRecorded(client, event)).rejects.toMatchObject({
      code: 'CANONICAL_INVENTORY_PROJECTION_FAILED',
    });
  });

  test('rejects aggregate mismatch', async () => {
    const client = { query: jest.fn() };
    await expect(processInventoryMovementRecorded(client, {
      event_type: 'inventory.movement.recorded', schema_version: 1,
      aggregate_type: 'inventory_movement', aggregate_id: 'other',
      payload: { movement: { id: 'mov-1' } },
    })).rejects.toMatchObject({ code: 'INVALID_INVENTORY_MOVEMENT_PAYLOAD' });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('rejects unsupported schema versions', async () => {
    const client = { query: jest.fn() };
    await expect(processInventoryMovementRecorded(client, {
      event_type: 'inventory.movement.recorded', schema_version: 2,
      aggregate_type: 'inventory_movement', aggregate_id: 'mov-1', payload: {},
    })).rejects.toMatchObject({ code: 'INVALID_INVENTORY_MOVEMENT_PAYLOAD' });
  });
});
