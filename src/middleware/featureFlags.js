const { jsonError } = require('../utils/responses');
const { resolveFeatures } = require('../utils/resolveFeatures');

const mergeFeatureFlags = (req, res, next) => {
  try {
    const subscriptionPlan = req.subscription?.plan_name;
    const tenant = req.tenant || {};
    const resolvedFeatures = resolveFeatures({
      ...tenant,
      plan_type: subscriptionPlan || tenant.plan_type
    });

    req.planFeatures = { ...resolvedFeatures };
    req.featureFlags = { ...resolvedFeatures };
    req.features = { ...resolvedFeatures };
    return next();
  } catch (error) {
    return jsonError(res, 500, 'FEATURE_FLAGS_FAILED', 'Failed to resolve feature flags');
  }
};

module.exports = { mergeFeatureFlags };
