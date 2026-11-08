const express = require('express');
const {
  createReturn,
  createUnreferencedReturn,
  listReturns,
  getReturnItems,
} = require('../controllers/returnsController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.post('/unreferenced', requirePermission('pos:refund'), createUnreferencedReturn);
router.post('/', requirePermission('pos:refund'), createReturn);
router.get('/', requirePermission('orders:read'), listReturns);
router.get('/:id', requirePermission('orders:read'), getReturnItems);

module.exports = router;
