const fs = require('fs');
const path = require('path');
const { requirePermission } = require('../src/middleware/requirePermission');

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const runPermissionGuard = (role, permission) => {
  const state = { status: 200, body: null };
  const res = {
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; },
  };
  let nextCalled = false;
  requirePermission(permission)({ user: { type: 'tenant', role } }, res, () => { nextCalled = true; });
  return { ...state, nextCalled };
};

describe('V1 legacy return authorization', () => {
  test('return mutation requires existing pos:refund authority', () => {
    const routes = source('src/routes/returnsRoutes.js');
    expect(routes).toContain("router.post('/', requirePermission('pos:refund'), createReturn)");
    expect(runPermissionGuard('cashier', 'pos:refund').nextCalled).toBe(false);
    expect(runPermissionGuard('manager', 'pos:refund').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'pos:refund').nextCalled).toBe(true);
  });

  test('return history uses orders:read authority', () => {
    const routes = source('src/routes/returnsRoutes.js');
    expect(routes).toContain("router.get('/', requirePermission('orders:read'), listReturns)");
    expect(routes).toContain("router.get('/:id', requirePermission('orders:read'), getReturnItems)");
    expect(runPermissionGuard('cashier', 'orders:read').nextCalled).toBe(true);
  });

  test('legacy return mutation is a real refund/stock/order mutation surface', () => {
    const orderController = source('src/controllers/orderController.js');
    expect(orderController).toContain('const processOrderReturn = async (req, res) => {');
    expect(orderController).toContain('INSERT INTO order_returns');
    expect(orderController).toContain("'refund'");
    expect(orderController).toContain('SET returned_amount = $1');
  });
});
