const express = require('express');
const controller = require('./purchaseReturn.controller');

const router = express.Router();

router.get('/', controller.requireTenantUser, controller.validateListPurchaseReturns, controller.listPurchaseReturns);
router.post('/', controller.requireAdmin, controller.validateCreatePurchaseReturn, controller.createPurchaseReturn);

module.exports = router;
