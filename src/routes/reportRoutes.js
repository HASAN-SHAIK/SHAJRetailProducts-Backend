const express = require('express');
const router = express.Router();
const { getSalesReport, getInventoryReport, getProfitReport, getProfitGraph } = require('../controllers/reportController');
const { getDailySalesReport } = require('../controllers/dailySalesReportController');
const { requirePermission } = require('../middleware/requirePermission');
const { requireReportScope } = require('../middleware/requireReportScope');
const { requireReportDateRange } = require('../middleware/requireReportDateRange');

router.get('/sales', requirePermission('reports:read'), requireReportScope, requireReportDateRange, getSalesReport);
router.get('/inventory', requirePermission('reports:read'), requireReportScope, getInventoryReport);
router.get('/daily', requirePermission('reports:read'), requireReportScope, getDailySalesReport);
router.get('/profit', requirePermission('reports:read'), requireReportScope, requireReportDateRange, getProfitReport);
router.get('/profit-graph', requirePermission('reports:read'), requireReportScope, getProfitGraph);

module.exports = router;
