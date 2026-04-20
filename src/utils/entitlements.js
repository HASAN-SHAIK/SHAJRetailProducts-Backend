const { resolveFeatures } = require('./resolveFeatures');

const FEATURE_ALIASES = {
  gst_invoice_enabled: ['GST_invoice_enabled', 'gst_enabled', 'enable_gst'],
  customer_details_enabled: ['customer_details_enabled', 'CUSTOMER_MODULE'],
  whatsapp_bill_enabled: ['WHATSAPP_BILL', 'whatsapp_bill_module'],
  receipt_module_enabled: ['receipt_module_enabled', 'receipt_module', 'enable_receipt'],
  advanced_reports: ['advanced_reports', 'advancedReports'],
  analytical_reports: ['analytical_reports', 'analyticalReports'],
  enable_barcode: ['enable_barcode'],
  mobile_access: ['mobile_access', 'MOBILE_ACCESS', 'mobile_module', 'mobile_module_enabled'],
  enable_weight_based: ['enable_weight_based'],
  enable_piece_based: ['enable_piece_based'],
  priority_support: ['priority_support']
};

const normalizePlanType = (planType) => {
  return (planType || 'basic').toString().trim().toLowerCase();
};

const ensureBooleanFeatures = (features = {}) => {
  const out = { ...features };
  Object.keys(FEATURE_ALIASES).forEach((key) => {
    const aliases = FEATURE_ALIASES[key];
    const value = aliases.some((alias) => out[alias] === true);
    out[key] = value;
    aliases.forEach((alias) => {
      if (!Object.prototype.hasOwnProperty.call(out, alias)) {
        out[alias] = value;
      }
    });
  });
  return out;
};

const resolveEntitlements = (tenant = {}, subscription = null) => {
  const rawFeatures = resolveFeatures({
    ...tenant,
    plan_type: subscription?.plan_name || tenant?.plan_type
  });
  const features = ensureBooleanFeatures(rawFeatures);
  return {
    plan_type: normalizePlanType(subscription?.plan_name || tenant?.plan_type),
    features
  };
};

const hasFeature = (features = {}, featureName) => {
  if (!featureName) return false;
  if (Object.prototype.hasOwnProperty.call(features, featureName)) {
    return features[featureName] === true;
  }
  const normalized = String(featureName).trim().toLowerCase();
  const aliases = FEATURE_ALIASES[normalized] || [featureName];
  return aliases.some((name) => features[name] === true);
};

module.exports = {
  FEATURE_ALIASES,
  normalizePlanType,
  resolveEntitlements,
  hasFeature,
  ensureBooleanFeatures
};
