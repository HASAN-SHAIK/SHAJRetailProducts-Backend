const PLAN_FEATURES = {
  basic: {
    enable_piece_based: true,
    enable_weight_based: true,
    is_order_based: true,
    GST_invoice_enabled: false,
    advanced_reports: false,
    analytical_reports: false,
    api_access: false,
    multi_branch: false,
    priority_support: false,
    max_users: 1,
    max_products: 500
  },
  pro: {
    enable_piece_based: true,
    enable_weight_based: true,
    is_order_based: true,
    GST_invoice_enabled: true,
    advanced_reports: true,
    analytical_reports: false,
    api_access: false,
    multi_branch: false,
    priority_support: false,
    max_users: 5,
    max_products: 5000
  },
  premium: {
    enable_piece_based: true,
    enable_weight_based: true,
    is_order_based: true,
    GST_invoice_enabled: true,
    advanced_reports: true,
    analytical_reports: true,
    api_access: true,
    multi_branch: true,
    priority_support: true,
    max_users: 20,
    max_products: null
  }
};

module.exports = PLAN_FEATURES;
