const fs = require('fs');
const path = require('path');

jest.mock('../db/masterPool', () => ({ connect: jest.fn() }));
jest.mock('../db/adminPool', () => ({ query: jest.fn() }));
jest.mock('../db/tenantPool', () => ({
  getTenantPool: jest.fn(),
  closeTenantPool: jest.fn(),
}));

const {
  FRESH_TENANT_V1_OVERLAY_MIGRATIONS,
  getFreshTenantOverlayPaths,
} = require('./tenantProvisionService');

describe('V1 fresh tenant schema overlays', () => {
  test('uses an explicit audited overlay list for certified V1 structures missing from the bootstrap baseline', () => {
    expect(FRESH_TENANT_V1_OVERLAY_MIGRATIONS).toEqual([
      '2026-08-16-v1-auth-tenant-roles.sql',
      '2026-08-13-pos-inventory-canonical-application.sql',
      '2026-08-14-pos-inventory-batch-allocations.sql',
      '2026-08-14-pos-inventory-reconciliation-provenance.sql',
      '2026-08-15-pos-customer-canonical-mapping.sql',
      '2026-08-15-customer-outstanding-projection.sql',
      '2026-08-18-pos-sale-category-snapshots.sql',
    ]);

    const paths = getFreshTenantOverlayPaths();
    expect(paths).toHaveLength(FRESH_TENANT_V1_OVERLAY_MIGRATIONS.length);
    for (const filePath of paths) {
      expect(fs.existsSync(filePath)).toBe(true);
      expect(path.dirname(filePath)).toBe(path.join(process.cwd(), 'Db', 'migrations'));
    }
  });

  test('overlay covers current certified inventory, customer and reporting schema facts', () => {
    const sql = getFreshTenantOverlayPaths()
      .map((filePath) => fs.readFileSync(filePath, 'utf8'))
      .join('\n');

    expect(sql).toContain('canonical_applied_at');
    expect(sql).toContain('pos_inventory_batch_allocations');
    expect(sql).toContain('canonical_branch_id');
    expect(sql).toContain('pos_customer_mappings');
    expect(sql).toContain('recompute_customer_outstanding');
    expect(sql).toContain('category_id_snapshot');
    expect(sql).toContain("manager");
    expect(sql).toContain("cashier");
  });
});
