const express = require('express');
const { createCorrection, listCorrections } = require('../controllers/correctionsController');
const { requirePermission } = require('../middleware/requirePermission');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

// Legacy correction mutations can cancel orders, restore stock, mutate GST and
// create financial adjustment transactions. Keep that authority Central/admin
// only instead of treating it as ordinary POS refund approval.
router.post('/', isAdmin, createCorrection);
router.get('/', requirePermission('orders:read'), listCorrections);

module.exports = router;
