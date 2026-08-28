const { ProductRepository } = require('./product.repository');

describe('V1 product catalog canonical branch inventory facts', () => {
  test('uses the same expiry-aware batch and provisional-deficit basis as the canonical inventory report', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          product_id: 101,
          physical_quantity: '12',
          sellable_quantity: '7',
          expired_quantity: '5',
          provisional_deficit: '2',
          projected_net_quantity: '5',
        }],
      }),
    };
    const repo = new ProductRepository(pool);
    const branchId = '11111111-1111-4111-8111-111111111111';

    const rows = await repo.findBranchInventoryFacts({ branchId, productIds: [101, '102', 101, 'invalid'] });

    expect(rows).toHaveLength(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([branchId, [101, 102]]);
    expect(sql).toContain('FROM batches b');
    expect(sql).toContain('COALESCE(b.quantity_remaining, b.quantity)');
    expect(sql).toContain('b.expiry_date >= CURRENT_DATE');
    expect(sql).toContain('b.expiry_date < CURRENT_DATE');
    expect(sql).toContain('FROM pos_inventory_batch_allocations a');
    expect(sql).toContain("a.allocation_kind = 'unallocated'");
    expect(sql).toContain("a.source_movement_type = 'sale_issue'");
    expect(sql).toContain("a.source_movement_type = 'sale_return'");
    expect(sql).toContain('p.id = ANY($2::bigint[])');
    expect(sql).toContain('COALESCE(p.is_batch_enabled, FALSE) = FALSE AND p.branch_id = $1::uuid');
    expect(sql).toContain('OR bt.product_id IS NOT NULL');
    expect(sql).toContain('OR pd.product_id IS NOT NULL');
    expect(sql).toContain('(sellable_quantity - provisional_deficit)::numeric AS projected_net_quantity');
  });

  test('does not invent branch stock without a trusted branch or valid product IDs', async () => {
    const pool = { query: jest.fn() };
    const repo = new ProductRepository(pool);

    await expect(repo.findBranchInventoryFacts({ branchId: null, productIds: [101] })).resolves.toEqual([]);
    await expect(repo.findBranchInventoryFacts({ branchId: 'branch-a', productIds: [] })).resolves.toEqual([]);
    await expect(repo.findBranchInventoryFacts({ branchId: 'branch-a', productIds: ['not-a-number'] })).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
