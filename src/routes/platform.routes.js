const express = require('express');
const {
  getDashboard,
  getTenants,
  getTenantById,
  createTenantHandler,
  updateTenant,
  updatePlan,
  getSubscriptionPayments,
  getSubscriptions,
  getRevenueReport,
  getActivityLogs,
  getPlans,
  getCreateTenantMeta,
  getReports,
  getGlobalReports,
  getSubscriptionsSummary,
  importProductsFromGoogleSheet,
  updateTenantPlanAndFlags,
  updateTenantAddons,
  createTenantUser,
  getTenantUsers,
  updateTenantUserRole,
  unregisterTenantUser,
  upgradeTenantPlan,
  renewTenantPlan,
  getTenantBranches,
  createTenantBranch,
  updateTenantBranch
} = require('../controllers/platformController');
const {
  getSupportCasesAdmin,
  getSupportCaseAdmin,
  updateSupportCaseStatus,
  updateSupportCaseAssignee,
  updateSupportCasePriority,
  replySupportCaseAdmin
} = require('../controllers/platformSupportController');

const router = express.Router();

router.get('/dashboard', getDashboard);
router.get('/tenants', getTenants);
router.get('/tenant/:id', getTenantById);
router.post('/create-tenant', createTenantHandler);
router.patch('/update-tenant', updateTenant);
router.patch('/update-tenant/:tenant_id', updateTenantPlanAndFlags);
router.patch('/tenants/:tenant_id/addons', updateTenantAddons);
router.patch('/update-plan/:tenant_id', updatePlan);
router.get('/subscription-payments', getSubscriptionPayments);
router.get('/subscriptions', getSubscriptions);
router.get('/subscriptions/summary', getSubscriptionsSummary);
router.get('/reports', getReports);
router.get('/globalreports', getGlobalReports);
router.get('/plans', getPlans);
router.get('/create-tenant/meta', getCreateTenantMeta);
router.get('/revenue-report', getRevenueReport);
router.get('/activity-logs', getActivityLogs);
router.post('/tenants/:tenant_id/products/import-google-sheet', importProductsFromGoogleSheet);
router.post('/tenants/:tenant_id/users', createTenantUser);
router.get('/tenants/:tenant_id/users', getTenantUsers);
router.get('/tenants/:tenant_id/branches', getTenantBranches);
router.post('/tenants/:tenant_id/branches', createTenantBranch);
router.patch('/tenants/:tenant_id/branches/:branch_id', updateTenantBranch);
router.post('/tenants/:tenant_id/upgrade-plan', upgradeTenantPlan);
router.post('/tenants/:tenant_id/renew-plan', renewTenantPlan);
router.patch('/users/:id/role', updateTenantUserRole);
router.delete('/tenants/:tenant_id/users/:id', unregisterTenantUser);
router.get('/support/cases', getSupportCasesAdmin);
router.get('/support/cases/:id', getSupportCaseAdmin);
router.patch('/support/cases/:id/status', updateSupportCaseStatus);
router.patch('/support/cases/:id/assign', updateSupportCaseAssignee);
router.patch('/support/cases/:id/priority', updateSupportCasePriority);
router.post('/support/cases/:id/reply', replySupportCaseAdmin);

module.exports = router;
