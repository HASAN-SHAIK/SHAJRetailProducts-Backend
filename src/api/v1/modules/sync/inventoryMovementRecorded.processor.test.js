const mockApplyPosInventoryBatchMovement = jest.fn().mockResolvedValue({ batch_applied: false, batch_enabled: false });
jest.mock('./posInventoryBatchAllocator', () => ({
  applyPosInventoryBatchMovement: (...args) => mockApplyPosInventoryBatchMovement(...args),
}));

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
  beforeEach(() => mockApplyPosInventoryBatchMovement.mockClear());

  test('applies a movement to canonical stock without requiring the sale projection first', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow()] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, stock_quantity: '4.000' }] }),
    };

    const inventoryDevice = { deviceId: 'device-e2e', branchId: '11111111-1111-1111-1111-111111111111' };
    const result = await processInventoryMovementRecorded(client, event, inventoryDevice);

    expect(result).toEqual({
      movement_id: 'mov-1',
      order_id: 'ord-1',
      product_id: '101',
      canonical_applied: true,
      canonical_stock_quantity: '4.000',
      batch: { batch_applied: false, batch_enabled: false },
    });
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FROM pos_sales'))).toBe(false);
    expect(String(client.query.mock.calls[3][0])).toContain("set_config('app.stock_source', 'pos_sync', true)");
    expect(client.query.mock.calls[3][1]).toEqual(['device-e2e', 'sale', 'mov-1']);
    expect(String(client.query.mock.calls[4][0])).toContain('UPDATE products');
    expect(client.query.mock.calls[4][1]).toEqual([-1000, 101]);
    expect(mockApplyPosInventoryBatchMovement).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ movementId: 'mov-1', productId: 101, orderItemId: 'itm-1' }),
      inventoryDevice
    );
  });

  test('maps sale returns to refund audit history while preserving immutable movement reference', async () => {
    const returnEvent = {
      ...event,
      aggregate_id: 'mov-return-1',
      payload: {
        movement: {
          ...event.payload.movement,
          id: 'mov-return-1',
          movement_type: 'sale_return',
          quantity_delta_milli: 250,
          balance_after_milli: 4250,
        },
      },
    };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-return-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow({
          movement_id: 'mov-return-1',
          movement_type: 'sale_return',
          quantity_delta_milli: '250',
          balance_after_milli: '4250',
        })] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-return-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, stock_quantity: '4.250' }] }),
    };

    await processInventoryMovementRecorded(client, returnEvent, { deviceId: 'device-e2e', branchId: '11111111-1111-1111-1111-111111111111' });

    expect(client.query.mock.calls[3][1]).toEqual(['device-e2e', 'refund', 'mov-return-1']);
    expect(client.query.mock.calls[4][1]).toEqual([250, 101]);
  });

  test('applies exactly once when sale.completed already projected the movement ledger row', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow()] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, stock_quantity: '4.000' }] }),
    };

    const result = await processInventoryMovementRecorded(client, event, { deviceId: 'device-e2e', branchId: '11111111-1111-1111-1111-111111111111' });

    expect(result.canonical_applied).toBe(true);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE products'))).toHaveLength(1);
    expect(mockApplyPosInventoryBatchMovement).toHaveBeenCalledTimes(1);
  });

  test('does not apply canonical stock or batches again when the movement was already applied', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [movementRow({ canonical_applied_at: new Date('2026-08-07T10:01:00Z') })],
        }),
    };

    const result = await processInventoryMovementRecorded(client, event, { branchId: '11111111-1111-1111-1111-111111111111' });

    expect(result).toMatchObject({ canonical_applied: false, already_applied: true });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE products'))).toBe(false);
    expect(mockApplyPosInventoryBatchMovement).not.toHaveBeenCalled();
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
    expect(mockApplyPosInventoryBatchMovement).not.toHaveBeenCalled();
  });

  test('fails retryably when the canonical Central product is missing', async () => {
    mockApplyPosInventoryBatchMovement.mockRejectedValueOnce(Object.assign(new Error('missing product'), {
      code: 'CANONICAL_INVENTORY_PROJECTION_FAILED',
    }));
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ movement_id: 'mov-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [movementRow()] }),
    };

    await expect(processInventoryMovementRecorded(client, event, { branchId: '11111111-1111-1111-1111-111111111111' })).rejects.toMatchObject({
      code: 'CANONICAL_INVENTORY_PROJECTION_FAILED',
    });
    expect(client.query).toHaveBeenCalledTimes(2);
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
