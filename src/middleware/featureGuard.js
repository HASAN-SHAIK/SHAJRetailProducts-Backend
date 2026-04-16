const { jsonError } = require('../utils/responses');
const { hasFeature } = require('../utils/entitlements');

const requireFeature = (flagName) => {
  return (req, res, next) => {
    const featureFlags = req.featureFlags;
    if (!featureFlags) {
      return jsonError(res, 500, 'FEATURE_FLAGS_MISSING', 'Feature configuration not found');
    }
    if (!hasFeature(featureFlags, flagName)) {
      return jsonError(res, 403, 'FEATURE_DISABLED', `Feature disabled: ${flagName}`);
    }
    return next();
  };
};

const featureGuardMiddleware = requireFeature;

module.exports = { requireFeature, featureGuardMiddleware };
