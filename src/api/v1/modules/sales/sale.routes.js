const express = require('express');
const controller = require('./sale.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListSales, controller.listSales);
router.get('/:id', controller.requireTenantUser, controller.validateSaleId, controller.getSale);
router.post('/', controller.requireTenantUser, controller.validateCreateSale, controller.createSale);
router.put('/:id', controller.requireTenantUser, controller.validateSaleId, controller.validateUpdateSale, controller.updateSale);
router.delete('/:id', controller.requireTenantUser, controller.validateSaleId, controller.deleteSale);

module.exports = router;
