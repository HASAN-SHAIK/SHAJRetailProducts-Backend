const { listInventoryReconciliation } = require('./inventoryReconciliationService');

describe('V1 inventory support reconciliation', () => {
  test('returns read-only Central/POS correlation facts with scoped filters', async () => {
    const rows = [{
      movement_id: 'mov-1',
      canonical_status: 'applied',
      canonical_device_id: 'device-1',
      canonical_branch_id: '11111111-1111-1111-1111-111111111111',
      pos_balance_after_milli: '4000',
      canonical_stock_quantity: '4.000',
      batch_allocations: [],
    }];
    const tenantPool = { query: jest.fn().mockResolvedValue({ rows }) };

    const result = await listInventoryReconciliation(tenantPool, {
      movementId: 'mov-1',
      branchId: '11111111-1111-1111-1111-111111111111',
      productId: '101',
      limit: 25,
    });

    expect(result).toEqual(rows);
    expect(tenantPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = tenantPool.query.mock.calls[0];
    expect(sql).toContain('FROM pos_inventory_movements m');
    expect(sql).toContain('LEFT JOIN pos_inventory_batch_allocations a');
    expect(sql).toContain('m.canonical_branch_id = $2::uuid');
    expect(sql).toContain("CASE WHEN m.canonical_applied_at IS NULL THEN 'pending' ELSE 'applied' END");
    expect(params).toEqual([
      'mov-1',
      '11111111-1111-1111-1111-111111111111',
      '101',
      25,
    ]);
  });

  test('caps support queries and does not mutate inventory', async () => {
    const tenantPool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await listInventoryReconciliation(tenantPool, { limit: 9999 });

    const [sql, params] = tenantPool.query.mock.calls[0];
    expect(params).toEqual([200]);
    expect(sql).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
  });
});
