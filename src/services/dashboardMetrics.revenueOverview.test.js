const { getRevenueOverview } = require('./dashboardMetrics');

describe('dashboard revenue overview', () => {
  test('falls back to canonical orders when dashboard metrics projection is empty', async () => {
    const tenantPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ total_revenue: '0', total_profit: '0', total_orders: 0 }] })
        .mockResolvedValueOnce({ rows: [{ total_revenue: '1300.00', total_profit: '320.00', total_orders: 4 }] }),
    };

    const result = await getRevenueOverview(
      tenantPool,
      'custom',
      '2026-08-01',
      '2026-08-31',
      undefined,
      undefined
    );

    expect(result.revenue_overview).toEqual({
      total_revenue: 1300,
      total_profit: 320,
      total_orders: 4,
      avg_order_value: 325,
    });
    expect(tenantPool.query).toHaveBeenCalledTimes(2);
    expect(tenantPool.query.mock.calls[1][0]).toContain('FROM orders');
    expect(tenantPool.query.mock.calls[1][0]).toContain('FROM order_returns r');
    expect(tenantPool.query.mock.calls[1][0]).toContain('LEFT JOIN order_items oi');
    expect(tenantPool.query.mock.calls[1][0]).toContain('COALESCE(oi.purchase_price_snapshot, p.purchase_price, 0)');
    expect(tenantPool.query.mock.calls[1][0]).toContain("order_status IN ('completed', 'partially_returned', 'fully_returned')");
  });

  test('keeps dashboard metrics when projection already has orders', async () => {
    const tenantPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ total_revenue: '900.00', total_profit: '120.00', total_orders: 3 }] })
        .mockResolvedValueOnce({ rows: [{ total_revenue: '1300.00', total_orders: 4 }] }),
    };

    const result = await getRevenueOverview(
      tenantPool,
      'custom',
      '2026-08-01',
      '2026-08-31',
      undefined,
      undefined
    );

    expect(result.revenue_overview).toEqual({
      total_revenue: 900,
      total_profit: 120,
      total_orders: 3,
      avg_order_value: 300,
    });
  });
});
