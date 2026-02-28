const { jsonError } = require('../utils/responses');
const { getPlanFeatures } = require('../utils/planFeatures');

const mergeFeatureFlags = (req, res, next) => {
  try {
    let resolvedFeatures = req.planFeatures && typeof req.planFeatures === 'object'
      ? req.planFeatures
      : {};

    const subscriptionPlan = req.subscription?.plan_name;
    const tenantPlan = req.tenant?.plan_type;
    if (subscriptionPlan) {
      resolvedFeatures = getPlanFeatures(subscriptionPlan);
    } else if (tenantPlan) {
      resolvedFeatures = getPlanFeatures(tenantPlan);
    }

    req.planFeatures = { ...resolvedFeatures };
    req.featureFlags = { ...resolvedFeatures };
    return next();
  } catch (error) {
    return jsonError(res, 500, 'FEATURE_FLAGS_FAILED', 'Failed to resolve feature flags');
  }
};

module.exports = { mergeFeatureFlags };
