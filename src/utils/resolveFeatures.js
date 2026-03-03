const PLAN_FEATURES = require('../config/planFeatures');
const { sanitizeAddons } = require('./addons');

const normalizePlanType = (planType) => {
  return (planType || 'basic').toString().trim().toLowerCase();
};

const resolveFeatures = (tenant = {}) => {
  const plan = normalizePlanType(tenant.plan_type);
  const coreFeatures = PLAN_FEATURES[plan] || PLAN_FEATURES.basic || {};
  const addonFeatures = sanitizeAddons(tenant.addons).addons;

  return {
    ...coreFeatures,
    ...addonFeatures
  };
};

module.exports = { resolveFeatures };
