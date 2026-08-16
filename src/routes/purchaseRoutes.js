const express = require('express');
const { createPurchase, listPurchases, getPurchaseDetail } = require('../controllers/purchaseController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.get('/', requirePermission('suppliers:read'), listPurchases);
router.get('/:id', requirePermission('suppliers:read'), getPurchaseDetail);
router.post('/', requirePermission('inventory:write'), createPurchase);

module.exports = router;
