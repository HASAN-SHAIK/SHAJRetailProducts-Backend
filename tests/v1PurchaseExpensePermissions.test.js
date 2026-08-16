const fs = require('fs');
const path = require('path');
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

const runGuard = (role, permission) => {
  const { state, res } = responseRecorder();
  let nextCalled = false;
  requirePermission(permission)({ user: { type: 'tenant', role } }, res, () => { nextCalled = true; });
  return { ...state, nextCalled };
};

describe('V1 purchase and expense authorization', () => {
  test('purchase routes require procurement/read and inventory-write authority', () => {
    const routes = source('src/routes/purchaseRoutes.js');
    expect(routes).toContain("router.get('/', requirePermission('suppliers:read'), listPurchases)");
    expect(routes).toContain("router.get('/:id', requirePermission('suppliers:read'), getPurchaseDetail)");
    expect(routes).toContain("router.post('/', requirePermission('inventory:write'), createPurchase)");
  });

  test('expense routes require explicit read/write authority', () => {
    const routes = source('src/routes/expenseRoutes.js');
    expect(routes).toContain("router.post('/', requirePermission('expenses:write'), addExpense)");
    expect(routes).toContain("router.get('/', requirePermission('expenses:read'), getExpenses)");
    expect(routes).toContain("router.put('/:id', requirePermission('expenses:write'), updateExpense)");
    expect(routes).toContain("router.delete('/:id', requirePermission('expenses:write'), deleteExpense)");
  });

  test('cashier cannot read procurement/expenses or mutate receiving and expenses', () => {
    for (const permission of ['suppliers:read', 'inventory:write', 'expenses:read', 'expenses:write']) {
      const result = runGuard('cashier', permission);
      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('FORBIDDEN');
    }
  });

  test('manager may read procurement/expenses and receive stock but cannot write expenses', () => {
    expect(runGuard('manager', 'suppliers:read').nextCalled).toBe(true);
    expect(runGuard('manager', 'inventory:write').nextCalled).toBe(true);
    expect(runGuard('manager', 'expenses:read').nextCalled).toBe(true);
    expect(runGuard('manager', 'expenses:write').nextCalled).toBe(false);
  });

  test('transitional staff and admin retain catalog-granted write authority', () => {
    for (const role of ['staff', 'admin']) {
      for (const permission of ['suppliers:read', 'inventory:write', 'expenses:read', 'expenses:write']) {
        expect(runGuard(role, permission).nextCalled).toBe(true);
      }
    }
  });
});
