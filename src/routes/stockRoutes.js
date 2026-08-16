const express = require('express');
const { getStockByBranch, adjustStock } = require('../controllers/stockController');
const { requirePermission } = require('../middleware/requirePermission');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.get('/', requirePermission('inventory:read'), getStockByBranch);
router.post('/adjustments', isAdmin, adjustStock);

module.exports = router;
