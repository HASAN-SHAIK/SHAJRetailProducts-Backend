const { applyPosInventoryBatchMovement } = require('./posInventoryBatchAllocator');

const branchId = '11111111-1111-1111-1111-111111111111';
const device = { deviceId: 'device-e2e', branchId };
const baseMovement = {
  movementId: 'mov-sale-1',
  orderId: 'ord-1',
  orderItemId: 'item-1',
  productId: 101,
  movementType: 'sale_issue',
  quantityDeltaMilli: -2500,
};

describe('Central POS batch allocation', () => {
  test('allocates sale issues FIFO and records provisional unallocated deficit', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, is_batch_enabled: true }] })
        .mockResolvedValueOnce({
          rowCount: 2,
          rows: [
            { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', quantity: '1.000', quantity_remaining: '1.000' },
            { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', quantity: '1.000', quantity_remaining: '0.500' },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const result = await applyPosInventoryBatchMovement(client, baseMovement, device);

    expect(result).toEqual({
      batch_applied: true,
      batch_enabled: true,
      batch_allocated_milli: 1500,
      unallocated_milli: 1000,
    });
    expect(String(client.query.mock.calls[1][0])).toContain('ORDER BY created_at ASC,id ASC');
    expect(client.query.mock.calls[2][1]).toEqual([1000, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 101, branchId]);
    expect(client.query.mock.calls[4][1]).toEqual([500, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 101, branchId]);
    const ledgerCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO pos_inventory_batch_allocations'));
    expect(ledgerCalls).toHaveLength(3);
    expect(ledgerCalls[2][1]).toEqual([
      'mov-sale-1', 3, 'ord-1', 'item-1', 101, branchId, null, 1000, 'unallocated', 'sale_issue',
    ]);
  });

  test('restores only original outstanding allocations for a partial return', async () => {
    const movement = {
      ...baseMovement,
      movementId: 'mov-return-1',
      movementType: 'sale_return',
      quantityDeltaMilli: 1250,
    };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, is_batch_enabled: true }] })
        .mockResolvedValueOnce({
          rowCount: 2,
          rows: [
            {
              batch_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              allocation_kind: 'batch',
              outstanding_milli: '1000',
            },
            { batch_id: null, allocation_kind: 'unallocated', outstanding_milli: '1000' },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    const result = await applyPosInventoryBatchMovement(client, movement, device);

    expect(result).toEqual({
      batch_applied: true,
      batch_enabled: true,
      batch_restored_milli: 1000,
      unallocated_restored_milli: 250,
    });
    expect(client.query.mock.calls[2][1]).toEqual([
      1000, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 101, branchId,
    ]);
    const ledgerCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO pos_inventory_batch_allocations'));
    expect(ledgerCalls).toHaveLength(2);
    expect(ledgerCalls[1][1]).toEqual([
      'mov-return-1', 2, 'ord-1', 'item-1', 101, branchId, null, 250, 'unallocated', 'sale_return',
    ]);
  });

  test('fails closed when a return exceeds the original outstanding allocation', async () => {
    const movement = {
      ...baseMovement,
      movementId: 'mov-return-too-large',
      movementType: 'sale_return',
      quantityDeltaMilli: 1500,
    };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, is_batch_enabled: true }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ batch_id: null, allocation_kind: 'unallocated', outstanding_milli: '1000' }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await expect(applyPosInventoryBatchMovement(client, movement, device)).rejects.toMatchObject({
      code: 'CANONICAL_INVENTORY_PROJECTION_FAILED',
    });
  });

  test('leaves Central batches untouched for products without batch tracking', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 101, is_batch_enabled: false }] }),
    };

    await expect(applyPosInventoryBatchMovement(client, baseMovement, device)).resolves.toEqual({
      batch_applied: false,
      batch_enabled: false,
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
