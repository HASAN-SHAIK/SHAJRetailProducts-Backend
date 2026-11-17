const express = require('express');
const { requirePermission } = require('../../../../middleware/requirePermission');
const { jsonError } = require('../../../../utils/responses');
const controller = require('./customer.controller');

const router = express.Router();

/**
 * DELETE (deactivate) authority decision (V1 Stage 1 risk #4):
 * requires `customers:write` (same permission model as legacy
 * src/modules/customers/routes.js) AND role admin or manager.
 * Staff hold customers:write for create/update but must not deactivate
 * customers; cashiers hold only customers:read and so never reach this rule.
 */
const DELETE_ALLOWED_ROLES = Object.freeze(['admin', 'manager']);
const requireCustomerDeleteRole = (req, res, next) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (!DELETE_ALLOWED_ROLES.includes(role)) {
    return jsonError(res, 403, 'FORBIDDEN', 'Only admin or manager can deactivate customers');
  }
  return next();
};

// Same permission model as legacy src/modules/customers/routes.js.
router.get('/', requirePermission('customers:read'), controller.validateListCustomers, controller.listCustomers);
router.get('/:id', requirePermission('customers:read'), controller.validateCustomerId, controller.getCustomer);

router.post('/', requirePermission('customers:write'), controller.validateCreateCustomer, controller.createCustomer);
router.put('/:id', requirePermission('customers:write'), controller.validateCustomerId, controller.validateUpdateCustomer, controller.updateCustomer);

router.delete('/:id', requirePermission('customers:write'), requireCustomerDeleteRole, controller.validateCustomerId, controller.deleteCustomer);

module.exports = router;
