const fs = require('fs');
const path = require('path');
const isAdmin = require('../src/middleware/isAdmin');
const { requirePermission } = require('../src/middleware/requirePermission');

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const responseRecorder = () => {
  const state = { status: 200, body: null };
  return {
    state,
    res: {
      status(code) { state.status = code; return this; },
      json(body) { state.body = body; return this; },
    },
  };
};

const runAdminGuard = (role) => {
  const { state, res } = responseRecorder();
  let nextCalled = false;
  isAdmin({ user: { type: 'tenant', role } }, res, () => { nextCalled = true; });
  return { ...state, nextCalled };
};

const runPermissionGuard = (role, permission) => {
  const { state, res } = responseRecorder();
  let nextCalled = false;
  requirePermission(permission)({ user: { type: 'tenant', role } }, res, () => { nextCalled = true; });
  return { ...state, nextCalled };
};

describe('V1 admin finance protected surfaces', () => {
  test('staff and salary administration are tenant-admin only', () => {
    const staff = source('src/routes/staffRoutes.js');
    const salary = source('src/routes/salaryRoutes.js');
    for (const routes of [staff, salary]) {
      expect(routes).toContain("router.post('/', isAdmin");
      expect(routes).toContain("router.get('/', isAdmin");
      expect(routes).toContain("router.put('/:id', isAdmin");
      expect(routes).toContain("router.delete('/:id', isAdmin");
    }
    expect(runAdminGuard('manager').nextCalled).toBe(false);
    expect(runAdminGuard('staff').nextCalled).toBe(false);
    expect(runAdminGuard('admin').nextCalled).toBe(true);
  });

  test('settings reads reuse settings:read while mutation remains admin-only', () => {
    const routes = source('src/routes/settingsRoutes.js');
    expect(routes).toContain("router.get('/', requirePermission('settings:read')");
    expect(routes).toContain("router.get('/application', requirePermission('settings:read')");
    expect(routes).toContain("router.put('/application', isAdmin");
    expect(runPermissionGuard('cashier', 'settings:read').nextCalled).toBe(false);
    expect(runPermissionGuard('manager', 'settings:read').nextCalled).toBe(false);
    expect(runPermissionGuard('staff', 'settings:read').nextCalled).toBe(true);
    expect(runAdminGuard('staff').nextCalled).toBe(false);
    expect(runAdminGuard('admin').nextCalled).toBe(true);
  });

  test('GST reports reuse reports:read while ledger mutation remains admin-only', () => {
    const routes = source('src/routes/gstRoutes.js');
    for (const route of ['/ledger', '/summary', '/reports', '/filing']) {
      expect(routes).toContain(`router.get('${route}', requirePermission('reports:read')`);
    }
    expect(routes).toContain("router.post('/ledger', isAdmin");
    expect(routes).toContain("router.put('/ledger/:id', isAdmin");
    expect(runPermissionGuard('cashier', 'reports:read').nextCalled).toBe(false);
    expect(runPermissionGuard('manager', 'reports:read').nextCalled).toBe(true);
    expect(runAdminGuard('manager').nextCalled).toBe(false);
    expect(runAdminGuard('admin').nextCalled).toBe(true);
  });

  test('legacy correction mutation stays admin-only while history uses orders:read', () => {
    const routes = source('src/routes/correctionsRoutes.js');
    expect(routes).toContain("router.post('/', isAdmin, createCorrection)");
    expect(routes).toContain("router.get('/', requirePermission('orders:read'), listCorrections)");
    expect(runPermissionGuard('cashier', 'orders:read').nextCalled).toBe(true);
    expect(runAdminGuard('cashier').nextCalled).toBe(false);
    expect(runAdminGuard('manager').nextCalled).toBe(false);
    expect(runAdminGuard('admin').nextCalled).toBe(true);
  });

  test('correction CANCEL semantics justify admin boundary instead of POS refund inheritance', () => {
    const controller = source('src/controllers/correctionsController.js');
    expect(controller).toContain("if (type === 'CANCEL')");
    expect(controller).toContain("SET order_status = 'cancelled'");
    expect(controller).toContain('SET stock_quantity = p.stock_quantity + u.qty');
    expect(controller).toContain("'ADJUSTMENT'");
    expect(controller).toContain("'out', 'adjustment', 'Order cancelled'");
  });
});
