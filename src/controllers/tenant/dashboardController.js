const { jsonError, jsonOk } = require('../../utils/responses');
const { getDateRange } = require('../../utils/dateRange');

const DASHBOARD_CACHE_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS || 5000);
const dashboardCache = new Map();

const getCacheKey = (prefix, tenantId, start, end, location, role) =>
  [
    prefix,
    tenantId || 'na',
    start?.toISOString?.() || '',
    end?.toISOString?.() || '',
    location || '',
    role || ''
  ].join('|');

const getCached = (key) => {
  const entry = dashboardCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DASHBOARD_CACHE_TTL_MS) {
    dashboardCache.delete(key);
    return null;
  }
  return entry.data;
};

const setCached = (key, data) => {
  dashboardCache.set(key, { ts: Date.now(), data });
};

const diffDays = (start, end) => {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
};

const percentGrowth = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
};

const getBasicDashboard = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');
    }

    const { tenantPool } = req;
    const { range, start_date: startDateRaw, end_date: endDateRaw, location: locationRaw } = req.query || {};
    const { start, end, range: resolvedRange } = getDateRange(range, startDateRaw, endDateRaw);
    const location = locationRaw && String(locationRaw).trim() ? String(locationRaw).trim() : null;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }

    const cacheKey = getCacheKey('basic', tenantId, start, end, location, req.user?.role);
    const cached = getCached(cacheKey);
    if (cached) {
      return jsonOk(res, cached);
    }

    const summaryRes = await tenantPool.query(
      `WITH orders_filtered AS (
         SELECT order_status, total_price
         FROM orders
         WHERE created_at BETWEEN $1 AND $2
           AND transaction_type = 'sale'
           AND ($3::text IS NULL OR location = $3)
       )
       SELECT
         (SELECT COUNT(*)::int FROM products WHERE is_deleted = FALSE) AS total_products,
         (SELECT COUNT(*)::int FROM products WHERE is_deleted = FALSE AND stock_quantity <= 5) AS low_stock,
         (SELECT COUNT(*)::int FROM products WHERE is_deleted = FALSE AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE) AS expired_products,
         (SELECT COUNT(*)::int FROM products WHERE is_deleted = FALSE AND expiry_date IS NOT NULL AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '7 days') AS expiring_7_days,
         (SELECT COUNT(*)::int FROM products WHERE is_deleted = FALSE AND expiry_date IS NOT NULL AND expiry_date > CURRENT_DATE + INTERVAL '7 days' AND expiry_date <= CURRENT_DATE + INTERVAL '30 days') AS expiring_30_days,
         (SELECT COUNT(*)::int FROM orders_filtered) AS total_orders,
         (SELECT COUNT(*) FILTER (WHERE order_status = 'pending')::int FROM orders_filtered) AS pending_orders,
         (SELECT COUNT(*) FILTER (WHERE order_status = 'completed')::int FROM orders_filtered) AS completed_orders,
         (SELECT COALESCE(SUM(total_price), 0)::numeric FROM orders_filtered) AS total_revenue`,
      [start, end, location]
    );

    const row = summaryRes.rows[0] || {};
    const payload = {
      range: resolvedRange,
      date_range: {
        start_date: start.toISOString(),
        end_date: end.toISOString()
      },
      products: {
        total: Number(row.total_products || 0),
        low_stock: Number(row.low_stock || 0),
        expiring_30_days: Number(row.expiring_30_days || 0),
        expiring_7_days: Number(row.expiring_7_days || 0),
        expired: Number(row.expired_products || 0)
      },
      orders: {
        total: Number(row.total_orders || 0),
        pending: Number(row.pending_orders || 0),
        completed: Number(row.completed_orders || 0)
      },
      revenue: {
        total: Number(row.total_revenue || 0)
      }
    };

    setCached(cacheKey, payload);
    return jsonOk(res, payload);
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'DASHBOARD_BASIC_FAILED', 'Failed to load dashboard');
  }
};

const getDashboardOverview = async (req, res) => {
  try {
    const { tenantPool } = req;
    const { range, start_date: startDateRaw, end_date: endDateRaw, location: locationRaw } = req.query || {};
    const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
    const location = locationRaw && String(locationRaw).trim() ? String(locationRaw).trim() : null;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }

    const cacheKey = getCacheKey('overview', req.user?.tenant_id, start, end, location, req.user?.role);
    const cached = getCached(cacheKey);
    if (cached) {
      return jsonOk(res, cached);
    }

    const windowDays = diffDays(start, end);
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(start.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const revenueOverviewQuery = tenantPool.query(
      `SELECT
         COALESCE(SUM(total_revenue), 0)::numeric AS total_revenue,
         COALESCE(SUM(total_profit), 0)::numeric AS total_profit,
         COALESCE(SUM(total_orders), 0)::int AS total_orders
       FROM tenant_dashboard_metrics
       WHERE day BETWEEN $1 AND $2
         AND ($3::text IS NULL OR location = $3)`,
      [start, end, location]
    );

    const revenueOverviewPrevQuery = tenantPool.query(
      `SELECT
         COALESCE(SUM(total_revenue), 0)::numeric AS total_revenue,
         COALESCE(SUM(total_profit), 0)::numeric AS total_profit,
         COALESCE(SUM(total_orders), 0)::int AS total_orders
       FROM tenant_dashboard_metrics
       WHERE day BETWEEN $1 AND $2
         AND ($3::text IS NULL OR location = $3)`,
      [prevStart, prevEnd, location]
    );

    const trendQuery = tenantPool.query(
      `SELECT day AS date,
              COALESCE(SUM(total_revenue), 0)::numeric AS revenue
       FROM tenant_dashboard_metrics
       WHERE day BETWEEN $1 AND $2
         AND ($3::text IS NULL OR location = $3)
       GROUP BY day
       ORDER BY day ASC`,
      [start, end, location]
    );

    const categoryQuery = tenantPool.query(
      `SELECT p.category AS category_name,
              COALESCE(SUM(oi.quantity * oi.selling_price), 0)::numeric AS revenue
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.created_at BETWEEN $1 AND $2
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY p.category
       ORDER BY revenue DESC`,
      [start, end, location]
    );

    const topProductsQuery = tenantPool.query(
      `SELECT p.id AS product_id,
              p.name AS product_name,
              COALESCE(SUM(oi.quantity), 0)::numeric AS quantity_sold,
              COALESCE(SUM(oi.quantity * oi.selling_price), 0)::numeric AS revenue
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.created_at BETWEEN $1 AND $2
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY p.id, p.name
       ORDER BY quantity_sold DESC
       LIMIT 10`,
      [start, end, location]
    );

    const lowStockQuery = tenantPool.query(
      `SELECT id, name, stock_quantity
       FROM products
       WHERE is_deleted = FALSE AND stock_quantity <= 5
       ORDER BY stock_quantity ASC
       LIMIT 10`
    );

    const deadStockQuery = tenantPool.query(
      `SELECT p.id, p.name, p.stock_quantity
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id AND o.created_at >= (CURRENT_DATE - INTERVAL '30 days') AND o.transaction_type = 'sale'
       WHERE p.is_deleted = FALSE
       GROUP BY p.id, p.name, p.stock_quantity
       HAVING COUNT(o.id) = 0
       ORDER BY p.stock_quantity DESC
       LIMIT 10`
    );

    const fastMovingQuery = tenantPool.query(
      `SELECT p.id, p.name, COALESCE(SUM(oi.quantity), 0)::numeric AS quantity_sold
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.created_at BETWEEN $1 AND $2
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY p.id, p.name
       ORDER BY quantity_sold DESC
       LIMIT 10`,
      [start, end, location]
    );

    const creditTopCustomersQuery = tenantPool.query(
      `SELECT c.id AS customer_id,
              c.name AS customer_name,
              COALESCE(SUM(t.total_price), 0)::numeric AS total_credit
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE t.payment_mode = 'credit'
         AND t.created_at BETWEEN $1 AND $2
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY c.id, c.name
       ORDER BY total_credit DESC
       LIMIT 10`,
      [start, end, location]
    );

    const creditTotalQuery = tenantPool.query(
      `SELECT COALESCE(SUM(t.total_price), 0)::numeric AS total_credit_outstanding
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       WHERE t.payment_mode = 'credit'
         AND t.created_at BETWEEN $1 AND $2
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)`,
      [start, end, location]
    );

    const newCustomersQuery = tenantPool.query(
      `SELECT COUNT(DISTINCT c.id)::int AS new_customers
       FROM customers c
       JOIN orders o ON o.customer_id = c.id
       WHERE c.created_at BETWEEN $1 AND $2
         AND o.created_at BETWEEN $1 AND $2
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)`,
      [start, end, location]
    );

    const [
      revenueOverviewRes,
      revenueOverviewPrevRes,
      trendRes,
      categoryRes,
      topProductsRes,
      lowStockRes,
      deadStockRes,
      fastMovingRes,
      creditTopCustomersRes,
      creditTotalRes,
      newCustomersRes
    ] = await Promise.all([
      revenueOverviewQuery,
      revenueOverviewPrevQuery,
      trendQuery,
      categoryQuery,
      topProductsQuery,
      lowStockQuery,
      deadStockQuery,
      fastMovingQuery,
      creditTopCustomersQuery,
      creditTotalQuery,
      newCustomersQuery
    ]);

    const current = revenueOverviewRes.rows[0];
    const previous = revenueOverviewPrevRes.rows[0];

    const totalRevenue = Number(current.total_revenue || 0);
    const totalProfit = Number(current.total_profit || 0);
    const totalOrders = Number(current.total_orders || 0);
    const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

    const revenueGrowth = percentGrowth(totalRevenue, Number(previous.total_revenue || 0));
    const profitGrowth = percentGrowth(totalProfit, Number(previous.total_profit || 0));
    const orderGrowth = percentGrowth(totalOrders, Number(previous.total_orders || 0));

    const inventory = {
      low_stock: lowStockRes.rows,
      dead_stock: deadStockRes.rows,
      fast_moving: fastMovingRes.rows
    };

    const smartInsights = [];
    if (inventory.low_stock.length > 0) {
      smartInsights.push({
        type: 'inventory',
        message: `Low stock items detected: ${inventory.low_stock.length}`
      });
    }
    if (revenueGrowth < 0) {
      smartInsights.push({
        type: 'revenue',
        message: 'Revenue has declined compared to the previous period'
      });
    }
    if (orderGrowth < 0) {
      smartInsights.push({
        type: 'orders',
        message: 'Order volume is down compared to the previous period'
      });
    }

    const response = {
      revenue_overview: {
        total_revenue: totalRevenue,
        total_profit: totalProfit,
        total_orders: totalOrders,
        avg_order_value: avgOrderValue
      },
      growth_comparison: {
        revenue_growth_percent: revenueGrowth,
        profit_growth_percent: profitGrowth,
        order_growth_percent: orderGrowth
      },
      trend_graph: trendRes.rows.map((row) => ({
        date: row.date,
        revenue: Number(row.revenue || 0)
      })),
      category_performance: categoryRes.rows.map((row) => ({
        category_id: null,
        category_name: row.category_name,
        revenue: Number(row.revenue || 0)
      })),
      top_products: topProductsRes.rows.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        quantity_sold: Number(row.quantity_sold || 0),
        revenue: Number(row.revenue || 0)
      })),
      inventory_intelligence: inventory,
      customer_credit: {
        top_customers: creditTopCustomersRes.rows.map((row) => ({
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          total_credit: Number(row.total_credit || 0)
        })),
        total_credit_outstanding: Number(creditTotalRes.rows[0]?.total_credit_outstanding || 0),
        new_customers: Number(newCustomersRes.rows[0]?.new_customers || 0)
      },
      smart_insights: smartInsights
    };

    if (req.user?.role === 'staff') {
      delete response.revenue_overview.total_revenue;
      delete response.revenue_overview.avg_order_value;
    }

    setCached(cacheKey, response);
    return jsonOk(res, response);
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'DASHBOARD_OVERVIEW_FAILED', 'Failed to load dashboard overview');
  }
};

module.exports = { getDashboardOverview, getBasicDashboard };
