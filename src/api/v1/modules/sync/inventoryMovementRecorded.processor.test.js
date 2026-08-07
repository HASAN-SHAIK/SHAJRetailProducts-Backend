const { processInventoryMovementRecorded } = require('./inventoryMovementRecorded.processor');

describe('inventory.movement.recorded projection', () => {
  test('projects a valid sale movement without requiring a completed sale row', async () => {
    const client = { query: jest.fn(async () => ({ rowCount: 1, rows: [] })) };
    const event = {
      event_type: 'inventory.movement.recorded', schema_version: 1,
      aggregate_type: 'inventory_movement', aggregate_id: 'mov-1', aggregate_version: 1,
      payload: { movement: {
        id: 'mov-1', store_id: 'store-1', product_id: 'product-1', movement_type: 'sale_issue',
        quantity_delta_milli: -1000, reference_type: 'sale_order', reference_id: 'ord-1',
        order_item_id: 'itm-1', balance_after_milli: -1000, occurred_at: '2026-08-07T10:00:00Z'
      }}
    };

    const result = await processInventoryMovementRecorded(client, event);
    expect(result).toEqual({ movement_id: 'mov-1', order_id: 'ord-1', product_id: 'product-1' });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0][0])).toContain('INSERT INTO pos_inventory_movements');
    expect(String(client.query.mock.calls[0][0])).toContain('ON CONFLICT(movement_id) DO UPDATE');
  });

  test('rejects aggregate mismatch', async () => {
    const client = { query: jest.fn() };
    await expect(processInventoryMovementRecorded(client, {
      event_type: 'inventory.movement.recorded', schema_version: 1,
      aggregate_type: 'inventory_movement', aggregate_id: 'other',
      payload: { movement: { id: 'mov-1' } }
    })).rejects.toMatchObject({ code: 'INVALID_INVENTORY_MOVEMENT_PAYLOAD' });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('rejects unsupported schema versions', async () => {
    const client = { query: jest.fn() };
    await expect(processInventoryMovementRecorded(client, {
      event_type: 'inventory.movement.recorded', schema_version: 2,
      aggregate_type: 'inventory_movement', aggregate_id: 'mov-1', payload: {}
    })).rejects.toMatchObject({ code: 'INVALID_INVENTORY_MOVEMENT_PAYLOAD' });
  });
});
