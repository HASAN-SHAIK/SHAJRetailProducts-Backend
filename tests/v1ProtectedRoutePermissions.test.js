const fs = require('fs');
const path = require('path');
const { requirePermission } = require('../src/middleware/requirePermission');

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

const runGuard = (user, permission) => {
  const { state, res } = responseRecorder();
  let nextCalled = false;
  requirePermission(permission)({ user }, res, () => { nextCalled = true; });
  return { ...state, nextCalled };
};

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('V1 protected Central route permissions', () => {
  test('cashier keeps ordinary sale/customer/read authority but cannot invoke privileged order mutations', () => {
    const cashier = { type: 'tenant', role: 'cashier' };
    expect(runGuard(cashier, 'pos:sale').nextCalled).toBe(true);
    expect(runGuard(cashier, 'products:read').nextCalled).toBe(true);
    expect(runGuard(cashier, 'customers:write').nextCalled).toBe(true);

    for (const permission of ['pos:discount', 'pos:refund', 'pos:void', 'orders:write', 'inventory:write']) {
      const result = runGuard(cashier, permission);
      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('FORBIDDEN');
    }
  });

  test('manager and admin retain their catalog-granted authority', () => {
    const manager = { type: 'tenant', role: 'manager' };
    for (const permission of ['products:read', 'orders:write', 'customers:write', 'inventory:write', 'pos:discount', 'pos:refund', 'pos:void']) {
      expect(runGuard(manager, permission).nextCalled).toBe(true);
    }

    const admin = { type: 'tenant', role: 'admin' };
    for (const permission of ['products:write', 'orders:write', 'inventory:write', 'pos:refund']) {
      expect(runGuard(admin, permission).nextCalled).toBe(true);
    }
  });

  test('missing tenant identity fails closed', () => {
    const missing = runGuard(null, 'orders:read');
    expect(missing.nextCalled).toBe(false);
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe('UNAUTHORIZED');
  });

  test('high-risk order mutations are guarded by explicit server-side permissions', () => {
    const routes = source('src/routes/orderRoutes.js');
    expect(routes).toContain("router.post('/:id/returns', requirePermission('pos:refund'), processOrderReturn)");
    expect(routes).toContain("router.patch('/:orderId/items/:itemId/price', requirePermission('pos:discount'), updateOrderItemPrice)");
    expect(routes).toContain("router.post('/', requirePermission('pos:sale'), createOrder)");
    expect(routes).toContain("router.put('/:id', requirePermission('orders:write'), updateOrder)");
    expect(routes).toContain("router.delete('/:id', requirePermission('pos:void'), deleteOrder)");
    expect(routes).toContain("router.post('/mark-paid', requirePermission('orders:write'), markOrderAsPaid)");
  });

  test('customer and read-side product/inventory routes require catalog permissions', () => {
    const customers = source('src/modules/customers/routes.js');
    expect(customers).toContain("router.get('/', requirePermission('customers:read'), handleGetCustomers)");
    expect(customers).toContain("router.post('/', requirePermission('customers:write'), handleCreateCustomer)");
    expect(customers).toContain("router.post('/:id/payments', requirePermission('customers:write'), handleAddPayment)");

    const products = source('src/routes/productRoutes.js');
    expect(products).toContain("router.get('/', requirePermission('products:read'), getProducts)");
    expect(products).toContain("router.get('/:id', requirePermission('products:read'), getProductById)");

    const stock = source('src/routes/stockRoutes.js');
    expect(stock).toContain("router.get('/', requirePermission('inventory:read'), getStockByBranch)");
  });
});
