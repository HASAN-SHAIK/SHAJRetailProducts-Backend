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

describe('V1 accounting authorization', () => {
  test('financial mutations remain admin-only Central authority', () => {
    const routes = source('src/routes/accountingRoutes.js');
    for (const expected of [
      "router.post('/receipt', isAdmin, validateReceiptEntry, createReceipt)",
      "router.post('/payment', isAdmin, validatePaymentEntry, createPayment)",
      "router.post('/opening-setup', isAdmin, saveOpeningSetup)",
      "router.post('/finalize-opening', isAdmin, finalizeOpening)",
    ]) {
      expect(routes).toContain(expected);
    }
  });

  test('accounting books and statements reuse reports:read authority', () => {
    const routes = source('src/routes/accountingRoutes.js');
    for (const route of [
      '/opening-setup',
      '/receipt',
      '/payment',
      '/cashbook',
      '/bankbook',
      '/cash-book',
      '/bank-book',
      '/ledger',
      '/reconcile',
      '/outstanding',
      '/reports/trial-balance',
      '/reports/profit-loss',
      '/reports/balance-sheet',
      '/reports/gst-summary',
    ]) {
      expect(routes).toContain(`router.get('${route}', requirePermission('reports:read')`);
    }
  });

  test('cashier cannot read accounting reports or mutate financial state', () => {
    expect(runPermissionGuard('cashier', 'reports:read').nextCalled).toBe(false);
    const mutation = runAdminGuard('cashier');
    expect(mutation.nextCalled).toBe(false);
    expect(mutation.status).toBe(403);
  });

  test('manager can read accounting reports but cannot mutate financial state', () => {
    expect(runPermissionGuard('manager', 'reports:read').nextCalled).toBe(true);
    const mutation = runAdminGuard('manager');
    expect(mutation.nextCalled).toBe(false);
    expect(mutation.status).toBe(403);
  });

  test('transitional staff can read reports but cannot mutate accounting', () => {
    expect(runPermissionGuard('staff', 'reports:read').nextCalled).toBe(true);
    expect(runAdminGuard('staff').nextCalled).toBe(false);
  });

  test('admin may read reports and perform financial mutations', () => {
    expect(runPermissionGuard('admin', 'reports:read').nextCalled).toBe(true);
    expect(runAdminGuard('admin').nextCalled).toBe(true);
  });
});
