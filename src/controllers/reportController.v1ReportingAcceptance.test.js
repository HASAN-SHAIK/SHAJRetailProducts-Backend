const fs = require('fs');
const path = require('path');
const { ROLE_PERMISSIONS } = require('../utils/rolePermissions');

describe('V1 Reporting/Admin permission authority', () => {
  test('reports:read remains an explicit manager/staff permission and is not granted to cashier', () => {
    expect(ROLE_PERMISSIONS.manager).toContain('reports:read');
    expect(ROLE_PERMISSIONS.staff).toContain('reports:read');
    expect(ROLE_PERMISSIONS.cashier).not.toContain('reports:read');
  });

  test('report routes enforce reports:read on every V1 report endpoint', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/reportRoutes.js'), 'utf8');
    for (const endpoint of ['/sales', '/inventory', '/daily', '/profit', '/profit-graph']) {
      expect(routes).toContain(`router.get('${endpoint}', requirePermission('reports:read')`);
    }
  });

  test('report controllers do not override reports:read with legacy admin-only success responses', () => {
    const controller = fs.readFileSync(path.join(__dirname, 'reportController.js'), 'utf8');
    expect(controller).not.toContain('Haha! You are not admin :)');
    expect(controller).not.toMatch(/decoded\.role\s*!==\s*['"]admin['"]/);
  });
});
