const express = require('express');
const platformConfigRoutes = require('./platformConfigRoutes');
const productRoutes = require('./productRoutes');
const orderRoutes = require('./orderRoutes');
const billingOrderRoutes = require('./billingOrderRoutes');
const reportRoutes = require('./reportRoutes');
const transactionRoutes = require('./transactionRoutes');
const shopDetailsRoutes = require('./shopDetailsRoutes');
const mobileRoutes = require('./mobileRoutes');
const whatsappRoutes = require('./whatsapp.routes');
const expenseRoutes = require('./expenseRoutes');
const settingsRoutes = require('./settingsRoutes');
const branchRoutes = require('./branchRoutes');
const stockRoutes = require('./stockRoutes');
const purchaseRoutes = require('./purchaseRoutes');
const purchaseInvoiceRoutes = require('./purchaseInvoiceRoutes');
const hsnRoutes = require('./hsnRoutes');
const batchRoutes = require('./batchRoutes');
const { getTenantMe, getPlatformBanner } = require('../controllers/tenantController');
const { getDashboardOverview, getBasicDashboard } = require('../controllers/tenant/dashboardController');
const { getRevenueOverview } = require('../controllers/tenant/revenueOverviewController');
const { getGrowthComparison } = require('../controllers/tenant/growthComparisonController');
const { getSalesTrend } = require('../controllers/tenant/salesTrendController');
const { getCategoryPerformance } = require('../controllers/tenant/categoryPerformanceController');
const { getInventoryIntelligence } = require('../controllers/tenant/inventoryIntelligenceController');
const { getCustomerCredit } = require('../controllers/tenant/customerCreditController');
const { getSmartInsights } = require('../controllers/tenant/smartInsightsController');
const { getLocationSummaryController } = require('../controllers/tenant/locationSummaryController');
const { getLocationsList } = require('../controllers/tenant/locationListController');
const { searchCustomers, getCustomers } = require('../controllers/tenant/customerController');
const { updateUserRole } = require('../controllers/tenant/userController');
const {
  getSupportCases,
  getSupportCase,
  createSupportCase,
  getSupportCategories,
  replySupportCase
} = require('../controllers/tenant/supportController');
const { requireFeature } = require('../middleware/featureGuard');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

router.use('/platform', platformConfigRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/billing/orders', billingOrderRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/expenses', expenseRoutes);
router.use('/reports', reportRoutes);
router.use('/transactions', transactionRoutes);
router.use('/shop-details', shopDetailsRoutes);
router.use('/mobile', mobileRoutes);
router.use('/settings', settingsRoutes);
router.use('/branches', branchRoutes);
router.use('/stock', stockRoutes);
router.use('/purchases', purchaseRoutes);
router.use('/purchase', purchaseInvoiceRoutes);
router.use('/hsn', hsnRoutes);
router.use('/batches', batchRoutes);
router.get('/tenant/me', getTenantMe);
router.get('/banner', getPlatformBanner);
router.get('/dashboard/overview', requireFeature('advanced_reports'), getDashboardOverview);
router.get('/dashboard', isAdmin, getBasicDashboard);
router.get('/dashboard/revenue-overview', isAdmin, requireFeature('advanced_reports'), getRevenueOverview);
router.get('/dashboard/growth-comparison', isAdmin, requireFeature('advanced_reports'), getGrowthComparison);
router.get('/dashboard/sales-trend', isAdmin, requireFeature('advanced_reports'), getSalesTrend);
router.get('/dashboard/category-performance', isAdmin, requireFeature('advanced_reports'), getCategoryPerformance);
router.get('/dashboard/inventory-intelligence', isAdmin, requireFeature('analytical_reports'), getInventoryIntelligence);
router.get('/dashboard/customer-credit', isAdmin, requireFeature('analytical_reports'), getCustomerCredit);
router.get('/dashboard/smart-insights', isAdmin, requireFeature('analytical_reports'), getSmartInsights);
router.get('/dashboard/location-summary', isAdmin, requireFeature('advanced_reports'), getLocationSummaryController);
router.get('/dashboard/location-performance', isAdmin, requireFeature('advanced_reports'), getLocationSummaryController);
router.get('/dashboard/locations-list', isAdmin, getLocationsList);
router.get('/support/cases', getSupportCases);
router.get('/support/cases/:id', getSupportCase);
router.post('/support/cases/:id/messages', replySupportCase);
router.post('/support/cases', createSupportCase);
router.get('/support/category', getSupportCategories);
router.get('/customers/search', searchCustomers);
router.get('/customers', getCustomers);
router.patch('/users/:id/role', isAdmin, updateUserRole);

module.exports = router;
