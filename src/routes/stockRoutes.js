const express = require('express');
const { getStockByBranch } = require('../controllers/stockController');

const router = express.Router();

router.get('/', getStockByBranch);

module.exports = router;
