const fs = require('fs');
const path = require('path');

const routes = fs.readFileSync(path.join(__dirname, 'staff.routes.js'), 'utf8');

describe('RetailHub staff-management authority', () => {
  test('staff reads remain tenant-user accessible for runtime identity views', () => {
    expect(routes).toContain("router.get('/', controller.requireTenantUser");
    expect(routes).toContain("router.get('/:id', controller.requireTenantUser");
  });

  test('staff management mutations require tenant administrator authority', () => {
    expect(routes).toContain("router.post('/', controller.requireAdmin");
    expect(routes).toContain("router.put('/:id', controller.requireAdmin");
    expect(routes).toContain("router.delete('/:id', controller.requireAdmin");
  });
});
