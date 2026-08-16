const express = require('express');
const { createReturn, listReturns, getReturnItems } = require('../controllers/returnsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.post('/', requirePermission('pos:refund'), createReturn);
router.get('/', requirePermission('orders:read'), listReturns);
router.get('/:id', requirePermission('orders:read'), getReturnItems);

module.exports = router;
