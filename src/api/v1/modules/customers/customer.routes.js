const express = require('express');
const { requirePermission } = require('../../../../middleware/requirePermission');
const isAdmin = require('../../../../middleware/isAdmin');
const controller = require('./customer.controller');

const router = express.Router();

// Read operations: require customers:read permission (cashier, staff, manager, admin)
router.get('/', requirePermission('customers:read'), controller.validateListCustomers, controller.listCustomers);
router.get('/:id', requirePermission('customers:read'), controller.validateCustomerId, controller.getCustomer);

// Mutation operations: require customers:write permission (manager, staff, admin; cashier strictly denied)
router.post('/', requirePermission('customers:write'), controller.validateCreateCustomer, controller.createCustomer);
router.put('/:id', requirePermission('customers:write'), controller.validateCustomerId, controller.validateUpdateCustomer, controller.updateCustomer);

// Deletion: strictly admin only Central authority
router.delete('/:id', isAdmin, controller.validateCustomerId, controller.deleteCustomer);

module.exports = router;
