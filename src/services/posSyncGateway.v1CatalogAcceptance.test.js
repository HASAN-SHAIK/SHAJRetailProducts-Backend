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

const poolFor = (products) => ({
  query: jest.fn()
    .mockResolvedValueOnce({ rows: products })
    .mockResolvedValueOnce({ rows: [] }),
});

describe('V1 Products/Catalog change-feed acceptance', () => {
  test('emits Central category identity before the product and preserves barcode/price facts', async () => {
    const tenantPool = poolFor([product()]);

    const result = await getPosChanges({ tenantPool, limit: 10 });

    expect(result.changes.map((change) => change.type)).toEqual([
      'catalog.category.upsert',
      'catalog.product.upsert',
      'catalog.barcode.upsert',
      'catalog.price.upsert',
    ]);

    const [category, catalogProduct, barcode, price] = result.changes;
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
  });

  test('propagates Central soft-delete as an inactive POS product without inventing a category', async () => {
    const tenantPool = poolFor([product({ category: null, barcode: null, selling_price: null, is_deleted: true })]);

    const result = await getPosChanges({ tenantPool, limit: 10 });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      type: 'catalog.product.upsert',
      payload: {
        id: '101',
        category_id: null,
        is_active: false,
      },
    });
  });

  test('uses an entity cursor so replaying the returned cursor does not repeat the same product record', async () => {
    const firstPool = poolFor([product()]);
    const first = await getPosChanges({ tenantPool: firstPool, limit: 10 });

    const replayPool = poolFor([product()]);
    const replay = await getPosChanges({ tenantPool: replayPool, cursorValue: first.cursor, limit: 10 });

    expect(replay.changes).toEqual([]);
    expect(replay.cursor).toBe(first.cursor);
  });
});
