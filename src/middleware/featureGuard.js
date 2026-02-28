const { jsonError } = require('../utils/responses');

const requireFeature = (flagName) => {
  return (req, res, next) => {
    const featureFlags = req.featureFlags;
    if (!featureFlags) {
      return jsonError(res, 500, 'FEATURE_FLAGS_MISSING', 'Feature configuration not found');
    }
    if (!Object.prototype.hasOwnProperty.call(featureFlags, flagName)) {
      return jsonError(res, 400, 'FEATURE_UNKNOWN', `Unknown feature: ${flagName}`);
    }
    if (!featureFlags[flagName]) {
      return jsonError(res, 403, 'FEATURE_DISABLED', `Feature disabled: ${flagName}`);
    }
    return next();
  };
};

const featureGuardMiddleware = requireFeature;

module.exports = { requireFeature, featureGuardMiddleware };
