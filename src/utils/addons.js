const { ALLOWED_ADDON_KEYS } = require('../config/addonFeatures');

const sanitizeAddons = (addons, { strict = false } = {}) => {
  const input = addons && typeof addons === 'object' && !Array.isArray(addons) ? addons : {};
  const allowed = new Set(ALLOWED_ADDON_KEYS);
  const clean = {};
  const invalidKeys = [];
  const invalidValues = [];

  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) {
      invalidKeys.push(key);
      continue;
    }
    if (typeof value !== 'boolean') {
      invalidValues.push(key);
      continue;
    }
    clean[key] = value;
  }

  if (strict && (invalidKeys.length > 0 || invalidValues.length > 0)) {
    return { valid: false, addons: {}, invalidKeys, invalidValues };
  }

  return { valid: true, addons: clean, invalidKeys, invalidValues };
};

module.exports = { sanitizeAddons };
