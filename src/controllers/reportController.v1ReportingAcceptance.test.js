const fs = require('fs');
const path = require('path');
const { ROLE_PERMISSIONS } = require('../utils/rolePermissions');
const { requireReportScope } = require('../middleware/requireReportScope');

describe('V1 Reporting/Admin permission authority', () => {
  test('reports:read remains an explicit manager/staff permission and is not granted to cashier', () => {
    expect(ROLE_PERMISSIONS.manager).toContain('reports:read');
    expect(ROLE_PERMISSIONS.staff).toContain('reports:read');
    expect(ROLE_PERMISSIONS.cashier).not.toContain('reports:read');
  });

  test('report routes enforce reports:read and the fail-closed report scope on every V1 report endpoint', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/reportRoutes.js'), 'utf8');
    for (const endpoint of ['/sales', '/inventory', '/daily', '/profit', '/profit-graph']) {
      expect(routes).toContain(`router.get('${endpoint}', requirePermission('reports:read'), requireReportScope`);
    }
  });

  test('branch-restricted users fail closed until every report query is trusted-branch scoped', () => {
    const req = {
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
    expect(res.body?.code).toBe('REPORT_BRANCH_SCOPE_REQUIRED');
  });

  test('all-branch report users may proceed after reports:read authorization', () => {
    const req = {
      user: {
        type: 'tenant',
        role: 'manager',
        all_branch_access: true,
        branch_id: null,
      },
    };
    const res = {};
    const next = jest.fn();

    requireReportScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('report controllers do not override reports:read with legacy admin-only success responses', () => {
    const controller = fs.readFileSync(path.join(__dirname, 'reportController.js'), 'utf8');
    expect(controller).not.toContain('Haha! You are not admin :)');
    expect(controller).not.toMatch(/decoded\.role\s*!==\s*['"]admin['"]/);
  });

  test('canonical sales and profit aggregates account for full and partial returns', () => {
    const controller = fs.readFileSync(path.join(__dirname, 'reportController.js'), 'utf8');

    // Revenue must use the canonical returned principal rather than the original gross sale.
    expect(controller).toContain('SUM(o.total_price - COALESCE(o.returned_amount, 0)) AS total_revenue');

    // Quantity/cost/profit/product-performance aggregates must remove returned quantities.
    expect(controller).toContain('GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)');
    expect(controller).toContain('SUM(ori.quantity) AS returned_qty');
    expect(controller).toContain('FROM order_returns r');
    expect(controller).toContain('JOIN order_return_items ori ON ori.return_id = r.id');

    // V1 reporting deliberately includes partially/fully returned orders so net facts remain visible.
    expect(controller).toContain("const SALES_STATUSES = ['completed', 'partially_returned', 'fully_returned'];");
  });
});
