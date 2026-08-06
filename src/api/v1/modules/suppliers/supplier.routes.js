const express = require('express');
const controller = require('./supplier.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListSuppliers, controller.listSuppliers);
router.get('/:id', controller.requireTenantUser, controller.validateSupplierId, controller.getSupplier);
router.post('/', controller.requireTenantUser, controller.validateCreateSupplier, controller.createSupplier);
router.put('/:id', controller.requireTenantUser, controller.validateSupplierId, controller.validateUpdateSupplier, controller.updateSupplier);
router.delete('/:id', controller.requireAdmin, controller.validateSupplierId, controller.deleteSupplier);

module.exports = router;
