const fs = require('fs');
const path = require('path');
const { enforceDashboardReportScope } = require('./dashboardReportScope');

const makeResponse = () => ({
  body: null,
  json(body) { this.body = body; return this; },
});

describe('V1 dashboard reporting authority', () => {
  test('dashboard overview route requires report permission and trusted scope', () => {
    const routesSource = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'tenant.routes.js'),
      'utf8'
    );

    expect(routesSource).toContain("requirePermission('reports:read')");
    expect(routesSource).toContain('requireReportScope');
    expect(routesSource).toContain('enforceDashboardReportScope');
  });

  test('trusted branch scope replaces caller supplied dashboard branch', () => {
    const req = {
      reportBranchId: '11111111-1111-4111-8111-111111111111',
      query: { branch_id: '22222222-2222-4222-8222-222222222222', range: 'today' },
    };
    const res = makeResponse();
    const next = jest.fn();

    enforceDashboardReportScope(req, res, next);

    expect(req.query.branch_id).toBe(req.reportBranchId);
    expect(req.query.range).toBe('today');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('branch dashboard suppresses uncertified stock widgets but keeps order-derived facts', () => {
    const req = {
      reportBranchId: '11111111-1111-4111-8111-111111111111',
      query: {},
    };
    const res = makeResponse();

    enforceDashboardReportScope(req, res, jest.fn());
    res.json({
      success: true,
      data: {
        inventory_intelligence: {
          low_stock: [{ id: 1 }],
          dead_stock: [{ id: 2 }],
          fast_moving: [{ id: 3 }],
        },
        smart_insights: [
          { type: 'inventory', message: 'unsafe branch stock insight' },
          { type: 'revenue', message: 'safe order insight' },
        ],
      },
    });

    expect(res.body.data.inventory_intelligence).toEqual({
      low_stock: null,
      dead_stock: null,
      fast_moving: [{ id: 3 }],
      inventory_scope: 'branch_inventory_unavailable',
    });
    expect(res.body.data.smart_insights).toEqual([
      { type: 'revenue', message: 'safe order insight' },
    ]);
  });

  test('all-branch dashboard does not inject caller branch or suppress inventory', () => {
    const req = { reportBranchId: null, query: { branch_id: 'caller-branch' } };
    const res = makeResponse();

    enforceDashboardReportScope(req, res, jest.fn());
    expect(req.query.branch_id).toBeUndefined();

    res.json({ success: true, data: { inventory_intelligence: { low_stock: [{ id: 1 }] } } });
    expect(res.body.data.inventory_intelligence.low_stock).toEqual([{ id: 1 }]);
  });
});
