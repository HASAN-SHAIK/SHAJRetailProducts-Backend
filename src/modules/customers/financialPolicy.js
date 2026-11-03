const { hasPermission } = require('../../utils/rolePermissions');

// Customer financial projection fields are owned by Central accounting.
//
//  - current_balance is never writable through the customer create/update APIs.
//    It changes only through orders, receipts, returns and other accounting
//    transactions.
//  - credit_limit is writable only by a caller holding this permission. Today
//    that is the admin role (wildcard grant) and nobody else; cashier, manager
//    and staff requests that include it are ignored, not rejected, so existing
//    clients that always send `credit_limit: 0` keep working.
const CUSTOMER_FINANCIAL_WRITE_PERMISSION = 'customers:financial:write';

const CREDIT_LIMIT_KEYS = ['credit_limit', 'creditLimit'];
const CURRENT_BALANCE_KEYS = ['current_balance', 'currentBalance'];

const canManageCustomerFinancials = (user) => hasPermission(user, CUSTOMER_FINANCIAL_WRITE_PERMISSION);

const hasKey = (payload, keys) =>
  Boolean(payload) &&
  keys.some(
    (key) =>
      Object.prototype.hasOwnProperty.call(payload, key) &&
      payload[key] !== undefined &&
      payload[key] !== null
  );

/** Names of financial fields in `payload` that the service will ignore for this caller. */
const listIgnoredFinancialFields = (payload, canManageFinancials) => {
  const ignored = [];
  if (hasKey(payload, CURRENT_BALANCE_KEYS)) ignored.push('current_balance');
  if (!canManageFinancials && hasKey(payload, CREDIT_LIMIT_KEYS)) ignored.push('credit_limit');
  return ignored;
};

module.exports = {
  CUSTOMER_FINANCIAL_WRITE_PERMISSION,
  canManageCustomerFinancials,
  listIgnoredFinancialFields,
};
