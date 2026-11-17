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

// Every signup provisions a full tenant database, so cap it per IP per day as well.
const onboardingDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: Math.max(1, Number(process.env.ONBOARDING_MAX_SIGNUPS_PER_IP_PER_DAY || 5)),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Daily company creation limit reached for this network. Please contact support.',
  },
});

const router = express.Router();

router.get('/plans', listPlansHandler);
router.post('/company', onboardingDailyLimiter, onboardingCreateLimiter, createCompanyHandler);
router.get(
  '/status',
  tenantAuthMiddleware,
  subscriptionMiddleware,
  mergeFeatureFlags,
  getOnboardingStatusHandler
);

module.exports = router;
