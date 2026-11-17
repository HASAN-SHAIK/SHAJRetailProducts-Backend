const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  listPlansHandler,
  createCompanyHandler,
  getOnboardingStatusHandler,
} = require('../controllers/onboardingController');
const { tenantAuthMiddleware } = require('../middleware/tenantAuthMiddleware');
const { subscriptionMiddleware } = require('../middleware/subscription');
const { mergeFeatureFlags } = require('../middleware/featureFlags');

const onboardingCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many company creation attempts. Please try again later.',
  },
});

const router = express.Router();

router.get('/plans', listPlansHandler);
router.post('/company', onboardingCreateLimiter, createCompanyHandler);
router.get(
  '/status',
  tenantAuthMiddleware,
  subscriptionMiddleware,
  mergeFeatureFlags,
  getOnboardingStatusHandler
);

module.exports = router;
