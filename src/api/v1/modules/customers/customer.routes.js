const express = require('express');
const controller = require('./customer.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListCustomers, controller.listCustomers);
router.get('/:id', controller.requireTenantUser, controller.validateCustomerId, controller.getCustomer);
router.post('/', controller.requireTenantUser, controller.validateCreateCustomer, controller.createCustomer);
router.put('/:id', controller.requireTenantUser, controller.validateCustomerId, controller.validateUpdateCustomer, controller.updateCustomer);
router.delete('/:id', controller.requireTenantUser, controller.validateCustomerId, controller.deleteCustomer);

module.exports = router;
