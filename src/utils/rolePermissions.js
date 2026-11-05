const POS_PERMISSIONS = Object.freeze({
  SALE: 'pos:sale',
  DISCOUNT: 'pos:discount',
  VOID: 'pos:void',
  REFUND: 'pos:refund',
  APPROVE: 'pos:approve',
});

const ACCOUNTING_PERMISSIONS = Object.freeze({
  RECEIPT_CREATE: 'accounting:receipt:create',
  RECEIPT_READ: 'accounting:receipt:read',
  PAYMENT_CREATE: 'accounting:payment:create',
  PAYMENT_READ: 'accounting:payment:read',
});

const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'products:read',
    'products:write',
    'orders:read',
    'orders:write',
    'customers:read',
    'customers:write',
    'inventory:read',
    'inventory:write',
    'suppliers:read',
    'expenses:read',
    'reports:read',
    ACCOUNTING_PERMISSIONS.RECEIPT_CREATE,
    ACCOUNTING_PERMISSIONS.RECEIPT_READ,
    ACCOUNTING_PERMISSIONS.PAYMENT_CREATE,
    ACCOUNTING_PERMISSIONS.PAYMENT_READ,
    POS_PERMISSIONS.SALE,
    POS_PERMISSIONS.DISCOUNT,
    POS_PERMISSIONS.VOID,
    POS_PERMISSIONS.REFUND,
    POS_PERMISSIONS.APPROVE,
  ],
  cashier: [
    'products:read',
    'orders:read',
    'customers:read',
    'inventory:read',
    ACCOUNTING_PERMISSIONS.RECEIPT_CREATE,
    ACCOUNTING_PERMISSIONS.RECEIPT_READ,
    POS_PERMISSIONS.SALE,
  ],
  // Transitional general store role. Keep the existing central permissions so
  // current staff accounts do not lose access while new installations move to
  // explicit cashier/manager roles.
  staff: [
    'products:read',
    'products:write',
    'orders:read',
    'orders:write',
    'customers:read',
    'customers:write',
    'inventory:read',
    'inventory:write',
    'suppliers:read',
    'suppliers:write',
    'expenses:read',
    'expenses:write',
    'reports:read',
    'settings:read',
    POS_PERMISSIONS.SALE,
    POS_PERMISSIONS.DISCOUNT,
  ],
};

const getPermissionsForRole = (role) => {
  const normalized = String(role || '').toLowerCase();
  return ROLE_PERMISSIONS[normalized] || [];
};

const getStorePermissions = (user = {}) => ({
  branch_id: user.branch_id || null,
  all_branch_access:
    user.all_branch_access === undefined || user.all_branch_access === null
      ? true
      : user.all_branch_access === true ||
        user.all_branch_access === 1 ||
        String(user.all_branch_access).toLowerCase() === 'true',
});

const hasPermission = (user, permission) => {
  const permissions = getPermissionsForRole(user?.role);
  if (permissions.includes('*')) return true;
  return permissions.includes(permission);
};

module.exports = {
  POS_PERMISSIONS,
  ACCOUNTING_PERMISSIONS,
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  getStorePermissions,
  hasPermission,
};
