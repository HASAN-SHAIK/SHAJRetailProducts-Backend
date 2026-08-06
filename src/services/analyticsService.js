const masterPool = require('../db/masterPool');

const DASHBOARD_CACHE_TTL_MS = 60_000;
let dashboardCache = { value: null, expiresAt: 0 };

const getActiveSubscriptionCounts = async () => {
  const result = await masterPool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (tenant_id)
              tenant_id,
              end_date,
              payment_status
       FROM subscriptions
       ORDER BY tenant_id, end_date DESC NULLS LAST, id DESC
     )
     SELECT
       COUNT(*) FILTER (WHERE payment_status = 'paid' AND end_date >= CURRENT_DATE) AS active_count,
       COUNT(*) FILTER (WHERE end_date < CURRENT_DATE OR payment_status != 'paid') AS expired_count
     FROM latest`
  );
  return result.rows[0] || { active_count: 0, expired_count: 0 };
};

const getDashboardStats = async () => {
  const now = Date.now();
  if (dashboardCache.value && dashboardCache.expiresAt > now) {
    return dashboardCache.value;
  }

  const result = await masterPool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM tenants) AS total_tenants,
       (SELECT COUNT(*)::int FROM tenants WHERE is_active = TRUE) AS active_tenants,
       (SELECT COUNT(*)::int FROM tenants WHERE is_active = FALSE) AS inactive_tenants,
       (SELECT COALESCE(SUM(amount), 0)::numeric FROM subscription_payments WHERE status = 'paid') AS total_revenue,
       (SELECT COALESCE(SUM(amount), 0)::numeric
        FROM subscription_payments
        WHERE status = 'paid'
          AND paid_at >= DATE_TRUNC('month', CURRENT_DATE)
          AND paid_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month') AS monthly_revenue,
       (SELECT COUNT(*)::int FROM subscriptions WHERE payment_status = 'paid') AS paid_subscriptions,
       (SELECT COUNT(*)::int
        FROM tenants
        WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)) AS new_tenants`
  );

  const { active_count, expired_count } = await getActiveSubscriptionCounts();
  const churnRate =
    Number(active_count) + Number(expired_count) === 0
      ? 0
      : Number(expired_count) / (Number(active_count) + Number(expired_count));

  const row = result.rows[0] || {};
  const stats = {
    total_tenants: row.total_tenants,
    active_tenants: row.active_tenants,
    inactive_tenants: row.inactive_tenants,
    total_revenue: row.total_revenue,
    monthly_revenue: row.monthly_revenue,
    active_subscriptions: Number(active_count),
    expired_subscriptions: Number(expired_count),
    churn_rate: churnRate,
    paid_subscriptions: row.paid_subscriptions,
    new_tenants: row.new_tenants,
  };

  dashboardCache = {
    value: stats,
    expiresAt: now + DASHBOARD_CACHE_TTL_MS,
  };
  return stats;
};

const getRevenueReport = async ({ from, to }) => {
  const params = [];
  const clauses = [`status = 'paid'`];
  if (from) {
    params.push(from);
    clauses.push(`paid_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`paid_at <= $${params.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const totalRes = await masterPool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total_revenue
     FROM subscription_payments
     ${whereClause}`,
    params
  );

  const monthlyRes = await masterPool.query(
    `SELECT DATE_TRUNC('month', paid_at) AS month,
            COALESCE(SUM(amount), 0)::numeric AS revenue
     FROM subscription_payments
     ${whereClause}
     GROUP BY 1
     ORDER BY 1 ASC`,
    params
  );

  const byPlanRes = await masterPool.query(
    `SELECT p.id AS plan_id, p.name AS plan_name, COALESCE(SUM(sp.amount), 0)::numeric AS revenue
     FROM subscription_payments sp
     LEFT JOIN plans p ON p.id = sp.plan_id
     ${whereClause}
     GROUP BY 1, 2
     ORDER BY revenue DESC NULLS LAST`,
    params
  );

  const activeVsExpired = await getActiveSubscriptionCounts();

  return {
    total_revenue: totalRes.rows[0].total_revenue,
    monthly: monthlyRes.rows,
    by_plan: byPlanRes.rows,
    active_vs_expired: {
      active: Number(activeVsExpired.active_count),
      expired: Number(activeVsExpired.expired_count),
    },
  };
};

const getRevenueSeries = async () => {
  const result = await masterPool.query(
    `SELECT DATE_TRUNC('month', paid_at) AS month,
            COALESCE(SUM(amount), 0)::numeric AS revenue
     FROM subscription_payments
     WHERE status = 'paid'
       AND paid_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
     GROUP BY 1
     ORDER BY 1 ASC`
  );

  const monthMap = new Map();
  for (const row of result.rows) {
    const d = new Date(row.month);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    monthMap.set(key, Number(row.revenue));
  }

  const now = new Date();
  const series = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    d.setUTCMonth(d.getUTCMonth() - i);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const monthLabel = d.toLocaleString('en-US', { month: 'short' });
    series.push({
      month: monthLabel,
      revenue: monthMap.get(key) ?? 0,
    });
  }

  return series;
};

const getRevenueByPlan = async () => {
  const result = await masterPool.query(
    `SELECT p.name AS plan_name, COALESCE(SUM(sp.amount), 0)::numeric AS revenue
     FROM subscription_payments sp
     LEFT JOIN plans p ON p.id = sp.plan_id
     WHERE sp.status = 'paid'
     GROUP BY 1
     ORDER BY revenue DESC NULLS LAST`
  );
  return result.rows.map((row) => ({
    name: row.plan_name || 'Unknown',
    value: Number(row.revenue),
  }));
};

const getTopTenantsByRevenue = async (limit = 10) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const result = await masterPool.query(
    `SELECT t.shop_name AS tenant_name,
            COALESCE(SUM(sp.amount), 0)::numeric AS revenue
     FROM subscription_payments sp
     LEFT JOIN tenants t ON t.id = sp.tenant_id
     WHERE sp.status = 'paid'
     GROUP BY t.shop_name
     ORDER BY revenue DESC NULLS LAST
     LIMIT $1`,
    [safeLimit]
  );

  return result.rows.map((row) => ({
    name: row.tenant_name || 'Unknown',
    revenue: Number(row.revenue),
  }));
};

const getRecentActivityLogs = async (limit = 5) => {
  const result = await masterPool.query(
    `SELECT id, action, entity_type, entity_id, created_at
     FROM platform_activity_logs
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
};

module.exports = {
  getDashboardStats,
  getRevenueReport,
  getActiveSubscriptionCounts,
  getRevenueSeries,
  getRevenueByPlan,
  getTopTenantsByRevenue,
  getRecentActivityLogs,
};
