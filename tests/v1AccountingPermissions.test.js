const fs = require('fs');
const path = require('path');
const isAdmin = require('../src/middleware/isAdmin');
const { requirePermission } = require('../src/middleware/requirePermission');
const {
  validateReceiptEntry,
  validatePaymentEntry,
} = require('../src/middleware/accountingValidation');

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

describe('V1 accounting authorization and validation', () => {
  test('operational receipt and payment routes use dedicated accounting permissions', () => {
    const routes = source('src/routes/accountingRoutes.js');
    expect(routes).toContain("router.post('/receipt', requirePermission('accounting:receipt:create'), validateReceiptEntry, createReceipt)");
    expect(routes).toContain("router.post('/payment', requirePermission('accounting:payment:create'), validatePaymentEntry, createPayment)");
    expect(routes).toContain("router.get('/receipt', requirePermission('accounting:receipt:read'), getReceiptEntries)");
    expect(routes).toContain("router.get('/payment', requirePermission('accounting:payment:read'), getPaymentEntries)");
  });

  test('opening setup and finalization remain admin-only Central authority', () => {
    const routes = source('src/routes/accountingRoutes.js');
    expect(routes).toContain("router.get('/opening-setup', isAdmin, getOpeningSetupSummary)");
    expect(routes).toContain("router.post('/opening-setup', isAdmin, saveOpeningSetup)");
    expect(routes).toContain("router.post('/finalize-opening', isAdmin, finalizeOpening)");
  });

  test('accounting books and statements reuse reports:read authority', () => {
    const routes = source('src/routes/accountingRoutes.js');
    for (const route of [
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

  test('cashier can create and read receipts, has customers:read only, and cannot access payments, write, reports, or opening setup', () => {
    expect(runPermissionGuard('cashier', 'accounting:receipt:create').nextCalled).toBe(true);
    expect(runPermissionGuard('cashier', 'accounting:receipt:read').nextCalled).toBe(true);
    expect(runPermissionGuard('cashier', 'customers:read').nextCalled).toBe(true);
    expect(runPermissionGuard('cashier', 'customers:write').nextCalled).toBe(false);
    expect(runPermissionGuard('cashier', 'accounting:payment:create').nextCalled).toBe(false);
    expect(runPermissionGuard('cashier', 'accounting:payment:read').nextCalled).toBe(false);
    expect(runPermissionGuard('cashier', 'reports:read').nextCalled).toBe(false);
    const opening = runAdminGuard('cashier');
    expect(opening.nextCalled).toBe(false);
    expect(opening.status).toBe(403);
  });

  test('manager can create/read receipts and payments, read/write customers, and view reports, but cannot access opening setup or delete customers', () => {
    expect(runPermissionGuard('manager', 'accounting:receipt:create').nextCalled).toBe(true);
    expect(runPermissionGuard('manager', 'accounting:receipt:read').nextCalled).toBe(true);
    expect(runPermissionGuard('manager', 'accounting:payment:create').nextCalled).toBe(true);
    expect(runPermissionGuard('manager', 'accounting:payment:read').nextCalled).toBe(true);
    expect(runPermissionGuard('manager', 'customers:read').nextCalled).toBe(true);
    expect(runPermissionGuard('manager', 'customers:write').nextCalled).toBe(true);
    expect(runPermissionGuard('manager', 'reports:read').nextCalled).toBe(true);
    const opening = runAdminGuard('manager');
    expect(opening.nextCalled).toBe(false);
    expect(opening.status).toBe(403);
  });

  test('staff cannot access receipt or payment entry operations', () => {
    expect(runPermissionGuard('staff', 'accounting:receipt:create').nextCalled).toBe(false);
    expect(runPermissionGuard('staff', 'accounting:receipt:read').nextCalled).toBe(false);
    expect(runPermissionGuard('staff', 'accounting:payment:create').nextCalled).toBe(false);
    expect(runPermissionGuard('staff', 'accounting:payment:read').nextCalled).toBe(false);
    expect(runAdminGuard('staff').nextCalled).toBe(false);
  });

  test('admin has wildcard access and passes all permission checks and admin guards', () => {
    expect(runPermissionGuard('admin', 'accounting:receipt:create').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'accounting:receipt:read').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'accounting:payment:create').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'accounting:payment:read').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'customers:read').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'customers:write').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'reports:read').nextCalled).toBe(true);
    expect(runAdminGuard('admin').nextCalled).toBe(true);
  });

  test('/v1/customers route guards strictly enforce customers:read, customers:write, and isAdmin', () => {
    const routes = source('src/api/v1/modules/customers/customer.routes.js');
    expect(routes).toContain("router.get('/', requirePermission('customers:read'), controller.validateListCustomers, controller.listCustomers)");
    expect(routes).toContain("router.get('/:id', requirePermission('customers:read'), controller.validateCustomerId, controller.getCustomer)");
    expect(routes).toContain("router.post('/', requirePermission('customers:write'), controller.validateCreateCustomer, controller.createCustomer)");
    expect(routes).toContain("router.put('/:id', requirePermission('customers:write'), controller.validateCustomerId, controller.validateUpdateCustomer, controller.updateCustomer)");
    expect(routes).toContain("router.delete('/:id', isAdmin, controller.validateCustomerId, controller.deleteCustomer)");

    // Cashier: has customers:read (for customer search and receipt collection), but CANNOT create, update, or delete
    expect(runPermissionGuard('cashier', 'customers:read').nextCalled).toBe(true);
    expect(runPermissionGuard('cashier', 'customers:write').nextCalled).toBe(false);
    expect(runAdminGuard('cashier').nextCalled).toBe(false);

    // Staff: has customers:read and customers:write, but CANNOT delete
    expect(runPermissionGuard('staff', 'customers:read').nextCalled).toBe(true);
    expect(runPermissionGuard('staff', 'customers:write').nextCalled).toBe(true);
    expect(runAdminGuard('staff').nextCalled).toBe(false);

    // Manager: has customers:read and customers:write, but CANNOT delete
    expect(runPermissionGuard('manager', 'customers:read').nextCalled).toBe(true);
    expect(runPermissionGuard('manager', 'customers:write').nextCalled).toBe(true);
    expect(runAdminGuard('manager').nextCalled).toBe(false);

    // Admin: passes all guards including delete
    expect(runPermissionGuard('admin', 'customers:read').nextCalled).toBe(true);
    expect(runPermissionGuard('admin', 'customers:write').nextCalled).toBe(true);
    expect(runAdminGuard('admin').nextCalled).toBe(true);
  });

  test('receipt entry validation requires valid UUID and allows cash, bank, online (with upi normalized)', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';

    // Invalid non-UUID string fails
    const { state: s1, res: r1 } = responseRecorder();
    let next1 = false;
    validateReceiptEntry({ body: { customer_id: 1, amount: 100, payment_mode: 'cash', client_txn_id: 'not-a-uuid' } }, r1, () => { next1 = true; });
    expect(next1).toBe(false);
    expect(s1.status).toBe(400);
    expect(s1.body.message).toBe('client_txn_id must be a valid UUID.');

    // Valid UUID and UPI normalization succeeds
    const req2 = { body: { customer_id: 1, amount: 100, payment_mode: 'upi', client_txn_id: validUuid } };
    const { res: r2 } = responseRecorder();
    let next2 = false;
    validateReceiptEntry(req2, r2, () => { next2 = true; });
    expect(next2).toBe(true);
    expect(req2.body.payment_mode).toBe('online');
  });

  test('payment entry validation strictly restricts modes to cash and bank only', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';

    // Disallow online/upi for payment entry
    const { state: s1, res: r1 } = responseRecorder();
    let next1 = false;
    validatePaymentEntry({ body: { type: 'expense', amount: 50, payment_mode: 'online', client_txn_id: validUuid } }, r1, () => { next1 = true; });
    expect(next1).toBe(false);
    expect(s1.status).toBe(400);
    expect(s1.body.message).toBe('payment_mode must be cash or bank.');

    // Disallow order_id for expense payment
    const { state: s2, res: r2 } = responseRecorder();
    let next2 = false;
    validatePaymentEntry({ body: { type: 'expense', amount: 50, payment_mode: 'cash', order_id: 123, client_txn_id: validUuid } }, r2, () => { next2 = true; });
    expect(next2).toBe(false);
    expect(s2.status).toBe(400);
    expect(s2.body.message).toBe('order_id is not allowed for expense or drawings payment.');

    // Valid supplier payment succeeds
    const req3 = { body: { type: 'supplier', supplier_id: 10, amount: 500, payment_mode: 'cash', client_txn_id: validUuid } };
    const { res: r3 } = responseRecorder();
    let next3 = false;
    validatePaymentEntry(req3, r3, () => { next3 = true; });
    expect(next3).toBe(true);
  });
});
