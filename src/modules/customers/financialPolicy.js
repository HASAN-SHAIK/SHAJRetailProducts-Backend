const { hasPermission } = require('../../utils/rolePermissions');

// Only roles holding this permission (admin, via the '*' wildcard) may manage
// customer credit limits. Balances are never written through the customer API.
const CUSTOMER_FINANCIAL_WRITE = 'customers:financial:write';

const canManageCustomerFinancials = (user) => Boolean(user) && hasPermission(user, CUSTOMER_FINANCIAL_WRITE);

module.exports = { CUSTOMER_FINANCIAL_WRITE, canManageCustomerFinancials };
