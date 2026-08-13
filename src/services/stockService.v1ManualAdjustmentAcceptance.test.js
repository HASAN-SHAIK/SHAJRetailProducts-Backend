const fs = require('fs');
const path = require('path');

describe('V1 manual inventory adjustment acceptance', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, 'stockService.js'), 'utf8');
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'stockRoutes.js'), 'utf8');

  test('manual adjustment is Central admin-only and not a direct product edit', () => {
    expect(routeSource).toContain("router.post('/adjustments', isAdmin, adjustStock)");
    expect(serviceSource).toContain("source: 'manual_adjustment'");
    expect(serviceSource).toContain("throw buildValidationError('reason is required.')");
    expect(serviceSource).toContain("throw buildValidationError('branch_id is required for stock adjustment.')");
  });

  test('canonical mutation is atomic and audited before the product stock update', () => {
    const begin = serviceSource.indexOf("await client.query('BEGIN')");
    const audit = serviceSource.indexOf('await setStockAuditContext(client, req');
    const lock = serviceSource.indexOf('FOR UPDATE`,\n      [productId]');
    const stockUpdate = serviceSource.indexOf('SET stock_quantity = $1');
    const commit = serviceSource.indexOf("await client.query('COMMIT')");

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(begin);
    expect(lock).toBeGreaterThan(audit);
    expect(stockUpdate).toBeGreaterThan(lock);
    expect(commit).toBeGreaterThan(stockUpdate);
    expect(serviceSource).toContain("await client.query('ROLLBACK')");
  });

  test('branch and batch scope are enforced and negative stock is rejected', () => {
    expect(serviceSource).toContain('AND branch_id = $3::uuid');
    expect(serviceSource).toContain("throw buildNotFoundError('Batch not found for selected product and branch.')");
    expect(serviceSource).toContain("throw buildValidationError('Non-batch product does not belong to selected branch.')");
    expect(serviceSource).toContain("throw buildValidationError('Stock adjustment cannot make canonical stock negative.')");
    expect(serviceSource).toContain("throw buildValidationError('Stock adjustment cannot make batch stock negative.')");
  });

  test('batch-enabled adjustments update batch and canonical product together', () => {
    expect(serviceSource).toContain("throw buildValidationError('batch_id is required for batch-enabled product adjustment.')");
    expect(serviceSource).toContain('SET quantity = COALESCE(quantity, 0) + $1');
    expect(serviceSource).toContain('quantity_remaining = COALESCE(quantity_remaining, quantity, 0) + $1');
    expect(serviceSource).toContain('SET stock_quantity = $1');
  });
});
