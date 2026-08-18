const fs = require('fs');
const path = require('path');
const { ROLE_PERMISSIONS } = require('../utils/rolePermissions');
const { requireReportScope } = require('../middleware/requireReportScope');
const { getSalesReport } = require('./reportController');

describe('V1 Reporting/Admin permission authority', () => {
  test('reports:read remains an explicit manager/staff permission and is not granted to cashier', () => {
    expect(ROLE_PERMISSIONS.manager).toContain('reports:read');
    expect(ROLE_PERMISSIONS.staff).toContain('reports:read');
    expect(ROLE_PERMISSIONS.cashier).not.toContain('reports:read');
  });

  test('report routes enforce reports:read and report scope on every V1 report endpoint', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/reportRoutes.js'), 'utf8');
    for (const endpoint of ['/sales', '/inventory', '/daily', '/profit', '/profit-graph']) {
      expect(routes).toContain(`router.get('${endpoint}', requirePermission('reports:read'), requireReportScope`);
    }
  });

  test('branch-restricted users are pinned to their trusted Central branch regardless of caller branch input', () => {
    const trustedBranch = '11111111-1111-1111-1111-111111111111';
    const spoofedBranch = '22222222-2222-2222-2222-222222222222';
    const req = {
      path: '/sales',
      headers: { 'x-branch-id': spoofedBranch },
      query: {},
      user: {
        type: 'tenant',
        role: 'manager',
        all_branch_access: false,
        branch_id: trustedBranch,
      },
    };
    const res = {};
    const next = jest.fn();

    requireReportScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.reportBranchId).toBe(trustedBranch);
  });

  test('branch-restricted users without a trusted branch fail closed', () => {
    const req = {
      path: '/sales',
      query: {},
      user: {
        type: 'tenant',
        role: 'manager',
        all_branch_access: false,
        branch_id: null,
      },
    };
    const res = {
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
    };
    const next = jest.fn();

    requireReportScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body?.code).toBe('REPORT_BRANCH_SCOPE_REQUIRED');
  });

  test('legacy inventory reporting stays fail-closed for branch-scoped requests', () => {
    const req = {
      path: '/inventory',
      query: {},
      user: {
        type: 'tenant',
        role: 'manager',
        all_branch_access: false,
        branch_id: '11111111-1111-1111-1111-111111111111',
      },
    };
    const res = {
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
    };
    const next = jest.fn();

    requireReportScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body?.code).toBe('REPORT_INVENTORY_BRANCH_SCOPE_REQUIRED');
  });

  test('branch-scoped profit response suppresses the legacy tenant-wide product count', () => {
    const req = {
      path: '/profit',
      query: {},
      user: {
        type: 'tenant',
        role: 'manager',
        all_branch_access: false,
        branch_id: '11111111-1111-1111-1111-111111111111',
      },
    };
    const res = {
      body: null,
      json(body) {
        this.body = body;
        return this;
      },
    };
    const next = jest.fn();

    requireReportScope(req, res, next);
    res.json({ total_revenue: 10, total_profit: 4, total_products: 99 });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body.total_products).toBeNull();
  });

  test('all-branch report users may request one branch or tenant-wide scope', () => {
    const branchReq = {
      path: '/sales',
      query: { branch_id: '33333333-3333-3333-8333-333333333333' },
      user: { type: 'tenant', role: 'admin', all_branch_access: true, branch_id: null },
    };
    const branchNext = jest.fn();
    requireReportScope(branchReq, {}, branchNext);
    expect(branchNext).toHaveBeenCalledTimes(1);
    expect(branchReq.reportBranchId).toBe('33333333-3333-3333-8333-333333333333');

    const tenantReq = {
      path: '/sales',
      query: {},
      user: { type: 'tenant', role: 'admin', all_branch_access: true, branch_id: null },
    };
    const tenantNext = jest.fn();
    requireReportScope(tenantReq, {}, tenantNext);
    expect(tenantNext).toHaveBeenCalledTimes(1);
    expect(tenantReq.reportBranchId).toBeNull();
  });

  test('sales report passes trusted branch as a bound SQL parameter to every aggregate', async () => {
    const branchId = '11111111-1111-1111-1111-111111111111';
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ total_revenue: 100 }] })
      .mockResolvedValueOnce({ rows: [{ total_orders: 1 }] })
      .mockResolvedValueOnce({ rows: [{ total_cost: 60 }] })
      .mockResolvedValueOnce({ rows: [{ total_profit: 40 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const req = {
      tenantPool: { query },
      reportBranchId: branchId,
      query: { from_date: '2026-08-01', to_date: '2026-08-31' },
      user: { type: 'tenant', role: 'manager' },
    };
    const res = {
      body: null,
      json(body) {
        this.body = body;
        return this;
      },
      status() {
        return this;
      },
    };

    await getSalesReport(req, res);

    expect(query).toHaveBeenCalledTimes(6);
    for (const call of query.mock.calls) {
      const [sql, values] = call;
      expect(sql).toContain('o.branch_id = $4::uuid');
      expect(values[3]).toBe(branchId);
    }
    expect(res.body.total_revenue).toBe(100);
    expect(res.body.total_orders).toBe(1);
  });

  test('report controllers do not override reports:read with legacy admin-only success responses', () => {
    const controller = fs.readFileSync(path.join(__dirname, 'reportController.js'), 'utf8');
    expect(controller).not.toContain('Haha! You are not admin :)');
    expect(controller).not.toMatch(/decoded\.role\s*!==\s*['"]admin['"]/);
  });

  test('canonical sales and profit aggregates account for full and partial returns', () => {
    const controller = fs.readFileSync(path.join(__dirname, 'reportController.js'), 'utf8');

    expect(controller).toContain('SUM(o.total_price - COALESCE(o.returned_amount, 0)) AS total_revenue');
    expect(controller).toContain('GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)');
    expect(controller).toContain('SUM(ori.quantity) AS returned_qty');
    expect(controller).toContain('FROM order_returns r');
    expect(controller).toContain('JOIN order_return_items ori ON ori.return_id = r.id');
    expect(controller).toContain("const SALES_STATUSES = ['completed', 'partially_returned', 'fully_returned'];");
  });
});
