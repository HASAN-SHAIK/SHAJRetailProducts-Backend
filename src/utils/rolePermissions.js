const ROLE_PERMISSIONS = {
  admin: ['*'],
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
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  getStorePermissions,
  hasPermission,
};
