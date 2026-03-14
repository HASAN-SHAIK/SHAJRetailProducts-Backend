const express = require('express');
const {
  getMobileDashboard,
  getMobileLowStock,
  getMobileSalesSummary
} = require('../controllers/mobileController');

const router = express.Router();

router.get('/dashboard', getMobileDashboard);
router.get('/low-stock', getMobileLowStock);
router.get('/sales-summary', getMobileSalesSummary);

module.exports = router;
