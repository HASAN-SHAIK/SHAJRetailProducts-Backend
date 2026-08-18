const express = require('express');
const { requireFeature } = require('../middleware/featureGuard');
const { requirePermission } = require('../middleware/requirePermission');
const { requireReportScope } = require('../middleware/requireReportScope');
const {
  getMobileDashboard,
  getMobileLowStock,
  getMobileSalesSummary
} = require('../controllers/mobileController');

const router = express.Router();
router.use(requireFeature('mobile_access'));
router.use(requirePermission('reports:read'));
router.use(requireReportScope);

router.get('/dashboard', getMobileDashboard);
router.get('/low-stock', getMobileLowStock);
router.get('/sales-summary', getMobileSalesSummary);

module.exports = router;
