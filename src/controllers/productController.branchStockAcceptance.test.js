const fs = require('fs');
const path = require('path');

describe('legacy product catalog branch stock projection', () => {
  test('uses batch totals only for batch-enabled products', () => {
    const source = fs.readFileSync(path.join(__dirname, 'productController.js'), 'utf8');

    expect((source.match(/WHEN COALESCE\(p\.is_batch_enabled, FALSE\) = TRUE THEN COALESCE\(bs\.stock_quantity, 0\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((source.match(/ELSE p\.stock_quantity/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((source.match(/\(COALESCE\(p\.is_batch_enabled, FALSE\) = FALSE AND p\.branch_id = \$1\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
