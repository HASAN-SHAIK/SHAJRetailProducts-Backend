jest.mock('../db', () => ({ connect: jest.fn(), query: jest.fn() }));

const mockMasterQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('../db/masterPool', () => ({ query: (...args) => mockMasterQuery(...args) }));
jest.mock('../db/tenantPool', () => ({
  getTenantPool: jest.fn(() => ({ connect: (...args) => mockConnect(...args) }))
}));

const { runConsistencyForAllActiveTenants, runConsistencyCheckForPool } = require('./stockConsistencyService');

describe('V1 scheduled batch reconciliation safety acceptance', () => {
  beforeEach(() => {
    mockMasterQuery.mockReset();
    mockConnect.mockReset();
  });

  test('scheduled consistency diagnoses product-vs-batch divergence without restoring product stock', async () => {
    mockMasterQuery.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'tenant-1', database_name: 'tenant_1' }]
    });

    const client = {
      release: jest.fn(),
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 77, started_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({
          rows: [{
            product_id: 101,
            product_name: 'Batch product',
            product_stock: '4.000',
            batch_total: '5.000'
          }]
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
    };
    mockConnect.mockResolvedValue(client);

    const summary = await runConsistencyForAllActiveTenants();

    expect(summary).toMatchObject({
      total_tenants: 1,
      completed_tenants: 1,
      failed_tenants: 0,
      mismatch_count: 1,
      healed_count: 0
    });
    expect(client.release).toHaveBeenCalledTimes(1);

    const calls = client.query.mock.calls;
    expect(calls[0][1]).toEqual([false, 'scheduled', 'system:tenant-1']);
    expect(calls.some(([sql]) => /UPDATE\s+products\s+SET\s+stock_quantity/i.test(sql))).toBe(false);

    const itemInsert = calls.find(([sql]) => sql.includes('INSERT INTO stock_consistency_run_items'));
    expect(itemInsert).toBeDefined();
    expect(itemInsert[1][6]).toBe(false);
    expect(itemInsert[1][7]).toBeNull();
  });

  test('explicit/manual consistency retains opt-in auto-heal behavior', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 88, started_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({
          rows: [{
            product_id: 102,
            product_name: 'Manual product',
            product_stock: '4.000',
            batch_total: '5.000'
          }]
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
    };

    const result = await runConsistencyCheckForPool(client, {
      autoHeal: true,
      source: 'manual',
      runBy: 'admin:1'
    });

    expect(result.mismatches).toEqual([
      expect.objectContaining({ product_id: 102, healed: true })
    ]);
    const productUpdate = client.query.mock.calls.find(([sql]) => /UPDATE\s+products\s+SET\s+stock_quantity/i.test(sql));
    expect(productUpdate).toBeDefined();
    expect(productUpdate[1]).toEqual([5, 102]);
  });
});
