const express = require('express');
const { getStockByBranch, adjustStock } = require('../controllers/stockController');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.get('/', getStockByBranch);
router.post('/adjustments', isAdmin, adjustStock);

module.exports = router;
