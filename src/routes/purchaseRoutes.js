const express = require('express');
const { createPurchase, listPurchases, getPurchaseDetail } = require('../controllers/purchaseController');

const router = express.Router();

router.get('/', listPurchases);
router.get('/:id', getPurchaseDetail);
router.post('/', createPurchase);

module.exports = router;
