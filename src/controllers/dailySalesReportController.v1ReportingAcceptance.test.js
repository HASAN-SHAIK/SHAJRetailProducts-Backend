jest.mock('../db', () => ({ query: jest.fn() }));

const { getDailySalesReport, getUtcDayRange } = require('./dailySalesReportController');

describe('V1 daily reporting canonical UTC behavior', () => {
  const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });

  test('uses strict UTC [start, end) day boundaries', () => {
    const range = getUtcDayRange('2026-08-18');
    expect(range.date).toBe('2026-08-18');
    expect(range.start.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-19T00:00:00.000Z');
    expect(getUtcDayRange('2026-02-30')).toBeNull();
    expect(getUtcDayRange('18-08-2026')).toBeNull();
  });

  test('daily revenue comes from immutable canonical order and return snapshots', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ total_revenue: '141.60' }] })
      .mockResolvedValueOnce({ rows: [{ total_orders: '1' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Milk', total_sold: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total_profit: '20.00' }] });
    const req = {
      tenantPool: { query },
      reportBranchId: branchId,
      query: { date: '2026-08-18' },
      user: { type: 'tenant', role: 'manager' },
    };
    const res = createResponse();

    await getDailySalesReport(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      date: '2026-08-18',
      total_revenue: '141.60',
      profit: '20.00',
      total_orders: '1',
      best_selling_products: [{ name: 'Milk', total_sold: '1' }],
    });

    const [revenueSql, revenueValues] = query.mock.calls[0];
    expect(revenueSql).toContain('SUM(o.total_price - COALESCE(o.returned_amount, 0))');
    expect(revenueSql).not.toContain('JOIN order_items');
    expect(revenueSql).toContain('o.created_at >= $1');
    expect(revenueSql).toContain('o.created_at < $2');
    expect(revenueSql).toContain('o.branch_id = $4::uuid');
    expect(revenueValues[0].toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(revenueValues[1].toISOString()).toBe('2026-08-19T00:00:00.000Z');
    expect(revenueValues[3]).toBe(branchId);

    for (const [, values] of query.mock.calls) {
      expect(values[0].toISOString()).toBe('2026-08-18T00:00:00.000Z');
      expect(values[1].toISOString()).toBe('2026-08-19T00:00:00.000Z');
      expect(values[3]).toBe(branchId);
    }
  });

  test('rejects invalid date input before querying PostgreSQL', async () => {
    const query = jest.fn();
    const req = {
      tenantPool: { query },
      query: { date: '2026-13-01' },
      user: { type: 'tenant', role: 'admin' },
    };
    const res = createResponse();

    await getDailySalesReport(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('YYYY-MM-DD');
    expect(query).not.toHaveBeenCalled();
  });
});
