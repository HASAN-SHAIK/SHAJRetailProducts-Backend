const { jsonError } = require('../utils/responses');
const { resolveEntitlements } = require('../utils/entitlements');

const mergeFeatureFlags = (req, res, next) => {
  try {
    const tenant = req.tenant || {};
    const entitlements = resolveEntitlements(tenant, req.subscription || null);
    const resolvedFeatures = entitlements.features;

    req.planFeatures = { ...resolvedFeatures };
    req.featureFlags = { ...resolvedFeatures };
    req.features = { ...resolvedFeatures };
    req.entitlements = entitlements;
    return next();
  } catch (error) {
    return jsonError(res, 500, 'FEATURE_FLAGS_FAILED', 'Failed to resolve feature flags');
  }
};

module.exports = { mergeFeatureFlags };
