const PLAN_FEATURES = require('../config/planFeatures');

const normalizePlanType = (planType) => {
  return (planType || 'basic').toString().trim().toLowerCase();
};

const getPlanFeatures = (planType) => {
  const plan = normalizePlanType(planType);
  return PLAN_FEATURES[plan] || PLAN_FEATURES.basic || {};
};

module.exports = { getPlanFeatures };
