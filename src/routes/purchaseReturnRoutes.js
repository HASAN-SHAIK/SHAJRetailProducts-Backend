const express = require('express');
const { createPurchaseReturn, listPurchaseReturns } = require('../controllers/purchaseReturnController');

const router = express.Router();

router.get('/', listPurchaseReturns);
router.post('/', createPurchaseReturn);

module.exports = router;
