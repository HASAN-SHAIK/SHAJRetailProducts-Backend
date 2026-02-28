const normalizePlanType = (planType) => {
  return (planType || 'basic').toString().trim().toLowerCase();
};

const getPlanFeatures = (planType) => {
  const plan = normalizePlanType(planType);
  const base = {
    enable_piece_based: true,
    enable_weight_based: true,
    is_order_based: true,
    customer_details_enabled: false,
    GST_invoice_enabled: false,
    advanced_reports: false,
    analytical_reports: false,
    api_access: false,
    multi_branch: false,
    priority_support: false,
    max_users: 1
  };

  if (plan === 'pro') {
    return {
      ...base,
      customer_details_enabled: true,
      GST_invoice_enabled: true,
      advanced_reports: true,
      max_users: 5
    };
  }

  if (plan === 'premium') {
    return {
      ...base,
      customer_details_enabled: true,
      GST_invoice_enabled: true,
      advanced_reports: true,
      analytical_reports: true,
      api_access: true,
      multi_branch: true,
      priority_support: true,
      max_users: 20
    };
  }

  return base;
};

module.exports = { getPlanFeatures };
