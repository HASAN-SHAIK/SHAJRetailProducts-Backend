jest.mock('../messaging/sync/syncOperation.service', () => ({
  processOperationInline: jest.fn(),
}));

const { getPosChanges } = require('./posSyncGateway');

const product = (overrides = {}) => ({
  id: 101,
  name: 'Fresh Milk',
  barcode: '8901234567890',
  selling_price: '65.50',
  category: 'Fresh Produce & Dairy',
  stock_quantity: '5.000',
  branch_id: 'branch-1',
  is_deleted: false,
  updated_at: new Date('2026-08-14T06:30:00.000Z'),
  ...overrides,
});

const poolFor = (products, categories = null) => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: products })
    .mockResolvedValueOnce({ rows: [] });
  if (categories !== null) query.mockResolvedValueOnce({ rows: categories.map((name) => ({ name })) });
  return { query };
};

describe('V1 Products/Catalog change-feed acceptance', () => {
  test('emits Central category identity before the product, preserves barcode/price facts, then emits the authoritative category snapshot', async () => {
    const tenantPool = poolFor([product()], ['Fresh Produce & Dairy']);

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });

    expect(result.changes.map((change) => change.type)).toEqual([
      'catalog.category.upsert',
      'catalog.product.upsert',
      'catalog.barcode.upsert',
      'catalog.price.upsert',
      'catalog.categories.snapshot',
    ]);

    const [category, catalogProduct, barcode, price, snapshot] = result.changes;
    const expectedCategoryId = encodeURIComponent('Fresh Produce & Dairy');

    expect(category.payload).toMatchObject({
      id: expectedCategoryId,
      name: 'Fresh Produce & Dairy',
      is_active: true,
    });
    expect(catalogProduct.payload).toMatchObject({
      id: '101',
      category_id: expectedCategoryId,
      name: 'Fresh Milk',
      is_active: true,
    });
    expect(barcode.payload).toMatchObject({
      barcode: '8901234567890',
      product_id: '101',
    });
    expect(price.payload).toMatchObject({
      product_id: '101',
      store_id: 'branch-1',
      amount_minor: 6550,
      currency: 'INR',
    });
    expect(snapshot.payload).toMatchObject({
      categories: [{ id: expectedCategoryId, name: 'Fresh Produce & Dairy' }],
      version: new Date('2026-08-14T06:30:00.000Z').getTime(),
    });

    expect(tenantPool.query.mock.calls[0][0]).not.toContain('branch_id IS NULL OR branch_id::text = $3');
    expect(tenantPool.query.mock.calls[0][1]).toHaveLength(2);
    expect(tenantPool.query.mock.calls[2][0]).toContain('branch_id IS NULL OR branch_id::text = $1');
    expect(tenantPool.query.mock.calls[2][1]).toEqual(['branch-1']);
  });

  test('propagates Central soft-delete and an empty authoritative snapshot when no categories remain', async () => {
    const tenantPool = poolFor([product({ category: null, barcode: null, selling_price: null, is_deleted: true })], []);

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });

    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toMatchObject({
      type: 'catalog.product.upsert',
      payload: {
        id: '101',
        category_id: null,
        is_active: false,
      },
    });
    expect(result.changes[1]).toMatchObject({
      type: 'catalog.categories.snapshot',
      payload: { categories: [] },
    });
  });

  test('emits only an ID/version removal tombstone when a changed product no longer applies to the trusted branch', async () => {
    const movedAt = new Date('2026-08-14T06:32:00.000Z');
    const tenantPool = poolFor([
      product({ branch_id: 'branch-2', name: 'Secret Branch Product', barcode: '9999999999999', selling_price: '99.99', updated_at: movedAt }),
    ], ['Fresh Produce & Dairy']);

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });

    expect(result.changes[0]).toEqual({
      id: `product:101:${movedAt.toISOString()}:remove`,
      type: 'catalog.product.remove',
      schema_version: 1,
      source: 'central',
      payload: {
        id: '101',
        version: movedAt.getTime(),
        source_updated_at: movedAt.toISOString(),
      },
    });
    expect(JSON.stringify(result.changes[0])).not.toContain('Secret Branch Product');
    expect(JSON.stringify(result.changes[0])).not.toContain('9999999999999');
    expect(JSON.stringify(result.changes[0])).not.toContain('99.99');
    expect(result.changes[1].type).toBe('catalog.categories.snapshot');
  });

  test('snapshot reflects the current global and trusted-branch category set', async () => {
    const tenantPool = poolFor(
      [product({ category: 'New Dairy', updated_at: new Date('2026-08-14T06:31:00.000Z') })],
      ['Bakery', 'New Dairy']
    );

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });
    const snapshot = result.changes[result.changes.length - 1];

    expect(snapshot.type).toBe('catalog.categories.snapshot');
    expect(snapshot.payload.categories).toEqual([
      { id: 'Bakery', name: 'Bakery' },
      { id: 'New%20Dairy', name: 'New Dairy' },
    ]);
  });

  test('uses an entity cursor so replaying the returned cursor does not repeat product or snapshot facts', async () => {
    const firstPool = poolFor([product()], ['Fresh Produce & Dairy']);
    const first = await getPosChanges({ tenantPool: firstPool, limit: 10, branchId: 'branch-1' });

    const replayPool = poolFor([product()]);
    const replay = await getPosChanges({ tenantPool: replayPool, cursorValue: first.cursor, limit: 10, branchId: 'branch-1' });

    expect(replay.changes).toEqual([]);
    expect(replay.cursor).toBe(first.cursor);
    expect(replayPool.query).toHaveBeenCalledTimes(2);
  });
});
