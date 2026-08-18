const fs = require('fs');
const path = require('path');
const {
  getMobileDashboard,
  getMobileLowStock,
  getMobileSalesSummary,
} = require('./mobileController');

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe('V1 mobile reporting authority', () => {
  test('mobile report routes reuse reports:read and trusted reporting scope', () => {
    const routesSource = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'mobileRoutes.js'),
      'utf8'
    );

    expect(routesSource).toContain("requirePermission('reports:read')");
    expect(routesSource).toContain('router.use(requireReportScope)');
  });

  test('sales summary binds canonical revenue to the trusted branch and tenant pool', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ today: 80, yesterday: 20, week: 100, month: 300 }],
    });
    const branchId = '11111111-1111-4111-8111-111111111111';
    const req = { tenantPool: { query }, reportBranchId: branchId };
    const res = makeResponse();

    await getMobileSalesSummary(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.today).toBe(80);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('total_price - COALESCE(returned_amount, 0)');
    expect(query.mock.calls[0][0]).toContain('branch_id = $2');
    expect(query.mock.calls[0][1][1]).toBe(branchId);
  });

  test('branch dashboard scopes sales/profit/recent orders and does not leak tenant stock', async () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    const query = jest.fn(async (sql) => {
      if (sql.includes('today_sales')) return { rows: [{ today_sales: 80, today_orders: 1 }] };
      if (sql.includes('today_profit')) return { rows: [{ today_profit: 20 }] };
      if (sql.includes('ORDER BY o.created_at DESC')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const req = { tenantPool: { query }, reportBranchId: branchId, query: {} };
    const res = makeResponse();

    await getMobileDashboard(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.today_sales).toBe(80);
    expect(res.body.data.low_stock_count).toBeNull();
    expect(res.body.data.inventory_scope).toBe('branch_inventory_unavailable');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([sql]) => !sql.includes('FROM products'))).toBe(true);
    expect(query.mock.calls.some(([sql, params]) => sql.includes('o.branch_id = $2') && params[1] === branchId)).toBe(true);
    expect(query.mock.calls.some(([sql, params]) => sql.includes('o.branch_id = $1') && params[0] === branchId)).toBe(true);
  });

  test('branch low-stock fails closed until certified branch inventory truth exists', async () => {
    const query = jest.fn();
    const req = {
      tenantPool: { query },
      reportBranchId: '11111111-1111-4111-8111-111111111111',
      query: {},
    };
    const res = makeResponse();

    await getMobileLowStock(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('REPORT_INVENTORY_BRANCH_SCOPE_REQUIRED');
    expect(query).not.toHaveBeenCalled();
  });

  test('mobile reports never fall back to the global database when tenant pool is absent', async () => {
    const res = makeResponse();

    await getMobileSalesSummary({ reportBranchId: null }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('MOBILE_TENANT_POOL_REQUIRED');
  });
});
