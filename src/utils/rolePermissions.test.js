const { POS_PERMISSIONS, getPermissionsForRole, hasPermission } = require('./rolePermissions');

describe('granular POS role permissions', () => {
  test('cashier can sell but cannot discount, void, refund, or approve', () => {
    const permissions = getPermissionsForRole('cashier');
    expect(permissions).toContain(POS_PERMISSIONS.SALE);
    expect(permissions).not.toContain(POS_PERMISSIONS.DISCOUNT);
    expect(permissions).not.toContain(POS_PERMISSIONS.VOID);
    expect(permissions).not.toContain(POS_PERMISSIONS.REFUND);
    expect(permissions).not.toContain(POS_PERMISSIONS.APPROVE);
  });

  test('manager has approval and sensitive POS capabilities', () => {
    const permissions = getPermissionsForRole('manager');
    expect(permissions).toEqual(expect.arrayContaining([
      POS_PERMISSIONS.SALE,
      POS_PERMISSIONS.DISCOUNT,
      POS_PERMISSIONS.VOID,
      POS_PERMISSIONS.REFUND,
      POS_PERMISSIONS.APPROVE,
    ]));
  });

  test('staff remains compatible while receiving explicit sale and discount capabilities', () => {
    const permissions = getPermissionsForRole('staff');
    expect(permissions).toContain('orders:write');
    expect(permissions).toContain(POS_PERMISSIONS.SALE);
    expect(permissions).toContain(POS_PERMISSIONS.DISCOUNT);
    expect(permissions).not.toContain(POS_PERMISSIONS.APPROVE);
  });

  test('admin wildcard still authorizes every POS capability', () => {
    expect(hasPermission({ role: 'admin' }, POS_PERMISSIONS.REFUND)).toBe(true);
    expect(hasPermission({ role: 'admin' }, POS_PERMISSIONS.APPROVE)).toBe(true);
  });
});
