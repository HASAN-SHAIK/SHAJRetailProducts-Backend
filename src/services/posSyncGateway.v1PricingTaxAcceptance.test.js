jest.mock('../messaging/sync/syncOperation.service', () => ({
  processOperationInline: jest.fn(),
}));

const { getPosChanges } = require('./posSyncGateway');

describe('V1 Pricing/Tax product fact transport', () => {
  test('emits canonical HSN and GST rate on the branch-scoped POS product projection', async () => {
    const updatedAt = new Date('2026-08-14T18:10:00.000Z');
    const tenantPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ has_pos_customer_mappings: true }] })
        .mockResolvedValueOnce({ rows: [{
          id: 101,
          name: 'GST Product',
          barcode: '8901234567890',
          selling_price: '118.00',
          category: 'Taxed',
          stock_quantity: '10.000',
          branch_id: 'branch-1',
          hsn_code: '0401',
          gst_percentage: '18.00',
          is_deleted: false,
          updated_at: updatedAt,
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ name: 'Taxed' }] }),
    };

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });
    const product = result.changes.find((change) => change.type === 'catalog.product.upsert');

    expect(tenantPool.query.mock.calls[1][0]).toContain('hsn_code, gst_percentage');
    expect(product.payload).toMatchObject({
      id: '101',
      tax_code: '0401',
      gst_rate_percent: 18,
    });
  });

  test('preserves an explicit zero GST rate and leaves missing tax facts null', async () => {
    const updatedAt = new Date('2026-08-14T18:11:00.000Z');
    const tenantPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ has_pos_customer_mappings: true }] })
        .mockResolvedValueOnce({ rows: [
          {
            id: 102, name: 'Zero GST', barcode: null, selling_price: null, category: null,
            stock_quantity: '1.000', branch_id: 'branch-1', hsn_code: null,
            gst_percentage: '0.00', is_deleted: false, updated_at: updatedAt,
          },
        ] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const result = await getPosChanges({ tenantPool, limit: 10, branchId: 'branch-1' });
    const product = result.changes.find((change) => change.type === 'catalog.product.upsert');

    expect(product.payload.tax_code).toBeNull();
    expect(product.payload.gst_rate_percent).toBe(0);
  });
});
