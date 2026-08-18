const express = require('express');
const router = express.Router();
const { getSalesReport, getInventoryReport, getProfitReport, getProfitGraph } = require('../controllers/reportController');
const { getBranchInventoryReport } = require('../controllers/branchInventoryReportController');
const { getDailySalesReport } = require('../controllers/dailySalesReportController');
const { requirePermission } = require('../middleware/requirePermission');
const { requireReportScope } = require('../middleware/requireReportScope');
const { requireReportDateRange } = require('../middleware/requireReportDateRange');

const getInventoryReportForScope = (req, res) => {
  if (req.reportBranchId) return getBranchInventoryReport(req, res);
  return getInventoryReport(req, res);
};

router.get('/sales', requirePermission('reports:read'), requireReportScope, requireReportDateRange, getSalesReport);
router.get('/inventory', requirePermission('reports:read'), requireReportScope, getInventoryReportForScope);
router.get('/daily', requirePermission('reports:read'), requireReportScope, getDailySalesReport);
router.get('/profit', requirePermission('reports:read'), requireReportScope, requireReportDateRange, getProfitReport);
router.get('/profit-graph', requirePermission('reports:read'), requireReportScope, getProfitGraph);

module.exports = router;
