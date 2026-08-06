const express = require('express');
const controller = require('./purchase.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListPurchases, controller.listPurchases);
router.get('/:id', controller.requireTenantUser, controller.validatePurchaseId, controller.getPurchase);
router.post('/', controller.requireTenantUser, controller.validateCreatePurchase, controller.createPurchase);

module.exports = router;
