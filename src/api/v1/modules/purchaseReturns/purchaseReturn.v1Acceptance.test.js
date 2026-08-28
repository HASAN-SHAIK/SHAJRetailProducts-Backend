const fs = require('fs');
const path = require('path');
const { purchaseReturnBodySchema, listPurchaseReturnsQuerySchema } = require('./purchaseReturn.validation');

const routeSource = fs.readFileSync(path.join(__dirname, 'purchaseReturn.routes.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, 'purchaseReturn.service.js'), 'utf8');

describe('V1 purchase return authority', () => {
  test('purchase return mutations require admin authority and reads remain tenant scoped', () => {
    expect(routeSource).toContain("router.get('/', controller.requireTenantUser");
    expect(routeSource).toContain("router.post('/', controller.requireAdmin");
  });

  test('V1 delegates inventory/accounting mutation to the canonical purchase return service', () => {
    expect(serviceSource).toContain("require('../../../../services/purchaseReturnService')");
    expect(serviceSource).toContain('legacyPurchaseReturnService.createPurchaseReturn');
    expect(serviceSource).toContain('legacyPurchaseReturnService.listPurchaseReturns');
  });

  test('rejects returns without canonical purchase, supplier and batch-linked item facts', () => {
    const { error } = purchaseReturnBodySchema.validate({ purchase_id: 1, supplier_id: 2, items: [] });
    expect(error).toBeTruthy();

    const valid = purchaseReturnBodySchema.validate({
      purchase_id: 1,
      supplier_id: 2,
      branch_id: '11111111-1111-4111-8111-111111111111',
      reason: 'Damaged carton',
      items: [{ batch_id: 10, product_id: 3, quantity: 2 }],
    });
    expect(valid.error).toBeUndefined();
  });

  test('validates tenant-facing return filters', () => {
    const valid = listPurchaseReturnsQuerySchema.validate({ purchase_id: 1, supplier_id: 2, limit: 25 });
    expect(valid.error).toBeUndefined();
    const invalid = listPurchaseReturnsQuerySchema.validate({ branch_id: 'not-a-uuid' });
    expect(invalid.error).toBeTruthy();
  });
});
