const fs = require('fs');
const path = require('path');

describe('V1 purchase receiving inventory acceptance', () => {
  const purchaseSource = fs.readFileSync(path.join(__dirname, 'purchaseService.js'), 'utf8');
  const auditSource = fs.readFileSync(path.join(__dirname, 'stockAuditService.js'), 'utf8');

  test('receiving is atomic and establishes purchase stock-audit context before stock mutation', () => {
    const begin = purchaseSource.indexOf("await client.query('BEGIN')");
    const audit = purchaseSource.indexOf("setStockAuditContext(client, req, { reason: 'purchase', source: 'purchase'");
    const stockUpdate = purchaseSource.indexOf('SET stock_quantity = COALESCE(stock_quantity, 0) + $1');
    const commit = purchaseSource.indexOf("await client.query('COMMIT')");

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(begin);
    expect(stockUpdate).toBeGreaterThan(audit);
    expect(commit).toBeGreaterThan(stockUpdate);
    expect(purchaseSource).toContain("await client.query('ROLLBACK')");
  });

  test('receiving locks canonical product and updates batch and product quantities in the same transaction', () => {
    expect(purchaseSource).toMatch(/FROM products[\s\S]*WHERE id = \$1 AND is_deleted = FALSE[\s\S]*FOR UPDATE/);
    expect(purchaseSource).toContain('SET quantity = COALESCE(quantity, 0) + $1');
    expect(purchaseSource).toContain('quantity_remaining = COALESCE(quantity_remaining, 0) + $1');
    expect(purchaseSource).toContain('SET stock_quantity = COALESCE(stock_quantity, 0) + $1');
    expect(purchaseSource).toContain('INSERT INTO order_items');
  });

  test('receiving enforces branch ownership for supplier and batch scope', () => {
    expect(purchaseSource).toContain("throw buildValidationError('supplier_id does not belong to selected branch.')");
    expect(purchaseSource).toMatch(/FROM batches[\s\S]*product_id = \$1[\s\S]*branch_id = \$3::uuid/);
    expect(purchaseSource).toContain('branch_id,\n              batch_number');
  });

  test('stock audit context carries actor, reason, source and reference into the database session', () => {
    expect(auditSource).toContain("set_config('app.actor_user_id'");
    expect(auditSource).toContain("set_config('app.actor_role'");
    expect(auditSource).toContain("set_config('app.actor_name'");
    expect(auditSource).toContain("set_config('app.stock_reason'");
    expect(auditSource).toContain("set_config('app.stock_source'");
    expect(auditSource).toContain("set_config('app.stock_reference'");
  });
});
