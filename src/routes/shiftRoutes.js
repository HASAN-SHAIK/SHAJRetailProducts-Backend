const express = require('express');
const {
  getCurrentShiftController,
  openShiftController,
  declareAndCloseShiftController,
  listShiftsController,
} = require('../controllers/shiftController');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.get('/current', requirePermission('orders:read'), getCurrentShiftController);
router.post('/open', requirePermission('orders:read'), openShiftController);
router.post('/declare', requirePermission('orders:read'), declareAndCloseShiftController);
router.post('/close', requirePermission('orders:read'), declareAndCloseShiftController);
router.get('/', requirePermission('orders:read'), listShiftsController);

module.exports = router;
