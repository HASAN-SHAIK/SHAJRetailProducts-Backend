jest.mock('../db', () => ({ query: jest.fn() }));

const { getHistoricalSalesReport } = require('./historicalSalesReportController');

describe('V1 historical product reporting', () => {
  test('uses immutable order-item identity and price snapshots instead of current catalog identity', async () => {
    const queries = [];
    const tenantPool = {
      query: jest.fn(async (sql, params) => {
        queries.push({ sql: String(sql), params });
        const call = queries.length;
        if (call === 1) return { rows: [{ total_revenue: '100.00', total_orders: '1' }] };
        if (call === 2) return { rows: [{ total_profit: '20.00' }] };
        if (call === 3) return { rows: [{ Name: 'Sold Name', NoOfSold: '1', Profit: '20.00' }] };
        return { rows: [{ Name: 'Sold Name', NoOfSold: '1', Profit: '20.00', Price: '100.00' }] };
      }),
    };
    const req = {
      user: { id: 7, role: 'manager' },
      tenantPool,
      reportBranchId: '11111111-1111-1111-1111-111111111111',
      query: {
        from_date: new Date('2026-08-01T00:00:00.000Z'),
        to_date: new Date('2026-08-31T23:59:59.999Z'),
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await getHistoricalSalesReport(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      total_revenue: '100.00',
      total_orders: '1',
      totalProfit: '20.00',
    }));

    const productSql = `${queries[2].sql}\n${queries[3].sql}`;
    expect(productSql).toContain('oi.product_name_snapshot');
    expect(productSql).toContain('oi.source_product_id');
    expect(productSql).toContain('oi.sku_snapshot');
    expect(productSql).toContain('oi.barcode_snapshot');
    expect(queries[3].sql).toContain('oi.unit_price_minor::numeric / 100.0');
    expect(productSql).toContain('LEFT JOIN products p');
    expect(productSql).not.toContain('GROUP BY p.id');
    expect(queries[2].params[3]).toBe(req.reportBranchId);
  });

  test('keeps current catalog fields as optional enrichment rather than the historical grouping key', async () => {
    const tenantPool = { query: jest.fn(async () => ({ rows: [{}] })) };
    const req = { user: { id: 1, role: 'admin' }, tenantPool, query: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await getHistoricalSalesReport(req, res);

    const productSql = tenantPool.query.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.includes('LEFT JOIN products p ON p.id = oi.product_id'))
      .join('\n');

    expect(productSql).toContain('MAX(p.name)');
    expect(productSql).toContain("MAX(NULLIF(oi.product_name_snapshot, ''))");
    expect(productSql).toContain('oi.source_product_id');
    expect(productSql).not.toContain('GROUP BY p.id');
    expect(res.json).toHaveBeenCalled();
  });
});
