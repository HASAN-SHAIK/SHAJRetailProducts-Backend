const { validateSalesInventory } = require('../../src/messaging/sync/inventoryGuard');

describe('inventoryGuard', () => {
  test('rejects sale when stock is insufficient', async () => {
    const tenantPool = {
      query: async (sql) => {
        if (sql.includes('FROM products') && sql.includes('ANY')) {
          return {
            rows: [{ id: 7, stock_quantity: 2, is_deleted: false, name: 'Sugar' }],
          };
        }
        return { rows: [{ consumed: 0 }] };
      },
    };

    const result = await validateSalesInventory(tenantPool, {
      transaction_type: 'sale',
      products: [{ product_id: 7, quantity: 5 }],
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVENTORY_PROTECTION');
    expect(result.violations[0].code).toBe('INSUFFICIENT_STOCK');
  });

  test('allows sale when stock is sufficient', async () => {
    const tenantPool = {
      query: async () => ({
        rows: [{ id: 7, stock_quantity: 10, is_deleted: false, name: 'Sugar' }],
      }),
    };

    const result = await validateSalesInventory(tenantPool, {
      transaction_type: 'sale',
      products: [{ product_id: 7, quantity: 2 }],
    });

    expect(result.ok).toBe(true);
  });
});
