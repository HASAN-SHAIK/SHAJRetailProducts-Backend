const express = require('express');
const { createPurchase } = require('../controllers/purchaseController');

const router = express.Router();

router.post('/', createPurchase);

module.exports = router;
