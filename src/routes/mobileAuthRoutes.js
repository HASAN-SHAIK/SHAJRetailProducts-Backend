const express = require('express');
const {
  mobileLogin,
  mobileRefresh,
  mobileLogout,
  getLogin,
} = require('../controllers/authController');
const { authTenantMiddleware } = require('../middleware/authTenant');
const { tenantLoginLimiter, tenantRefreshLimiter } = require('../middleware/authRateLimits');

const router = express.Router();

router.post('/login', tenantLoginLimiter, mobileLogin);
router.post('/refresh', tenantRefreshLimiter, mobileRefresh);
router.post('/logout', mobileLogout);
router.get('/me', authTenantMiddleware, getLogin);

module.exports = router;
