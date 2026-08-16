const express = require('express');
const router = express.Router();
const { getSalesReport, getInventoryReport, getDailySalesReport, getProfitReport, getProfitGraph } = require('../controllers/reportController');
const { requirePermission } = require('../middleware/requirePermission');

router.get('/sales', requirePermission('reports:read'), getSalesReport);
router.get('/inventory', requirePermission('reports:read'), getInventoryReport);
router.get('/daily', requirePermission('reports:read'), getDailySalesReport);
router.get('/profit', requirePermission('reports:read'), getProfitReport);
router.get('/profit-graph', requirePermission('reports:read'), getProfitGraph);

module.exports = router;
