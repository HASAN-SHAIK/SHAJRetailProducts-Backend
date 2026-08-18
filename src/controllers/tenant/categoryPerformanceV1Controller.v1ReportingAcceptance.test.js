const { getCategoryPerformance } = require('./categoryPerformanceV1Controller');

describe('V1 Reporting/Admin immutable category attribution', () => {
  const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });

  test('reports categories from sale-time snapshots and never joins the current catalog', async () => {
    const sql = [];
    let call = 0;
    const tenantPool = {
      query: jest.fn(async (text) => {
        sql.push(text);
        call += 1;
        if (call === 1) {
          return {
            rows: [
              { category_id: 'cat-beverages', category_name: 'Beverages', revenue: '100.00' },
              { category_id: null, category_name: 'Unattributed', revenue: '25.00' },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    const req = {
      user: { tenant_id: 'tenant-a' },
      query: { range: 'last_30_days' },
      tenantPool,
    };
    const res = makeResponse();

    await getCategoryPerformance(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.category_attribution).toBe('sale_snapshot');
    expect(res.body.data.category_performance).toEqual([
      expect.objectContaining({ category_id: 'cat-beverages', category_name: 'Beverages', revenue: 100 }),
      expect.objectContaining({ category_id: null, category_name: 'Unattributed', revenue: 25 }),
    ]);

    const joinedSql = sql.join('\n');
    expect(joinedSql).toContain('oi.category_id_snapshot');
    expect(joinedSql).toContain('oi.category_name_snapshot');
    expect(joinedSql).toContain("'Unattributed'");
    expect(joinedSql).toContain('order_return_items');
    expect(joinedSql).not.toMatch(/JOIN\s+products\b/i);
    expect(joinedSql).not.toContain('p.category');
  });

  test('location grouping retains snapshot attribution rather than current catalog state', async () => {
    let call = 0;
    const tenantPool = {
      query: jest.fn(async () => {
        call += 1;
        if (call === 1) {
          return {
            rows: [
              { location: 'Store A', category_id: 'cat-a', category_name: 'Original Category', revenue: '50.00' },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    const req = {
      user: { tenant_id: 'tenant-a' },
      query: { range: 'last_30_days', group_by: 'location' },
      tenantPool,
    };
    const res = makeResponse();

    await getCategoryPerformance(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.category_attribution).toBe('sale_snapshot');
    expect(res.body.data.grouped[0].category_performance[0]).toEqual(
      expect.objectContaining({
        category_id: 'cat-a',
        category_name: 'Original Category',
        revenue: 50,
        percentage: 100,
      })
    );
  });
});
