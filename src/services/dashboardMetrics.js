const { getDateRange } = require('../utils/dateRange');

const diffDays = (start, end) => {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
};

const percentGrowth = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
};

const normalizeLocation = (value) => {
  const text = (value || '').toString().trim();
  return text ? text : null;
};

const getRevenueOverview = async (tenantPool, range, startDateRaw, endDateRaw, locationRaw) => {
  const { start, end, range: resolvedRange } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);

  const result = await tenantPool.query(
    `SELECT
       COALESCE(SUM(total_revenue), 0)::numeric AS total_revenue,
       COALESCE(SUM(total_profit), 0)::numeric AS total_profit,
       COALESCE(SUM(total_orders), 0)::int AS total_orders
     FROM tenant_dashboard_metrics
     WHERE day BETWEEN $1 AND $2
       AND ($3::text IS NULL OR location = $3)`,
    [start, end, location]
  );

  const row = result.rows[0] || {};
  const totalRevenue = Number(row.total_revenue || 0);
  const totalProfit = Number(row.total_profit || 0);
  const totalOrders = Number(row.total_orders || 0);
  const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

  return {
    range: resolvedRange,
    start,
    end,
    revenue_overview: {
      total_revenue: totalRevenue,
      total_profit: totalProfit,
      total_orders: totalOrders,
      avg_order_value: avgOrderValue
    }
  };
};

const getGrowthComparison = async (
  tenantPool,
  range,
  startDateRaw,
  endDateRaw,
  locationRaw,
  groupBy
) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);

  const windowDays = diffDays(start, end);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(start.getTime() - windowDays * 24 * 60 * 60 * 1000);

  if (groupBy === 'location') {
    const result = await tenantPool.query(
      `SELECT
         location,
         COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_revenue END), 0)::numeric AS current_revenue,
         COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_profit END), 0)::numeric AS current_profit,
         COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_orders END), 0)::int AS current_orders,
         COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_revenue END), 0)::numeric AS previous_revenue,
         COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_profit END), 0)::numeric AS previous_profit,
         COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_orders END), 0)::int AS previous_orders
       FROM tenant_dashboard_metrics
       WHERE day BETWEEN $3 AND $2
         AND location IS NOT NULL
         AND ($5::text IS NULL OR location = $5)
       GROUP BY location
       ORDER BY location ASC`,
      [start, end, previousStart, previousEnd, location]
    );

    const grouped = result.rows.map((row) => {
      const currentRevenue = Number(row.current_revenue || 0);
      const currentProfit = Number(row.current_profit || 0);
      const currentOrders = Number(row.current_orders || 0);
      const previousRevenue = Number(row.previous_revenue || 0);
      const previousProfit = Number(row.previous_profit || 0);
      const previousOrders = Number(row.previous_orders || 0);

      return {
        location: row.location,
        current_period: {
          start_date: start,
          end_date: end,
          revenue: currentRevenue,
          profit: currentProfit,
          orders: currentOrders
        },
        previous_period: {
          start_date: previousStart,
          end_date: previousEnd,
          revenue: previousRevenue,
          profit: previousProfit,
          orders: previousOrders
        },
        growth: {
          revenue_growth_percent: percentGrowth(currentRevenue, previousRevenue),
          profit_growth_percent: percentGrowth(currentProfit, previousProfit),
          order_growth_percent: percentGrowth(currentOrders, previousOrders)
        }
      };
    });

    return { grouped };
  }

  const result = await tenantPool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_revenue END), 0)::numeric AS current_revenue,
       COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_profit END), 0)::numeric AS current_profit,
       COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_orders END), 0)::int AS current_orders,
       COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_revenue END), 0)::numeric AS previous_revenue,
       COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_profit END), 0)::numeric AS previous_profit,
       COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_orders END), 0)::int AS previous_orders
     FROM tenant_dashboard_metrics
     WHERE day BETWEEN $3 AND $2
       AND ($5::text IS NULL OR location = $5)`,
    [start, end, previousStart, previousEnd, location]
  );

  const row = result.rows[0] || {};
  const currentRevenue = Number(row.current_revenue || 0);
  const currentProfit = Number(row.current_profit || 0);
  const currentOrders = Number(row.current_orders || 0);
  const previousRevenue = Number(row.previous_revenue || 0);
  const previousProfit = Number(row.previous_profit || 0);
  const previousOrders = Number(row.previous_orders || 0);

  return {
    current_period: {
      start_date: start,
      end_date: end,
      revenue: currentRevenue,
      profit: currentProfit,
      orders: currentOrders
    },
    previous_period: {
      start_date: previousStart,
      end_date: previousEnd,
      revenue: previousRevenue,
      profit: previousProfit,
      orders: previousOrders
    },
    growth: {
      revenue_growth_percent: percentGrowth(currentRevenue, previousRevenue),
      profit_growth_percent: percentGrowth(currentProfit, previousProfit),
      order_growth_percent: percentGrowth(currentOrders, previousOrders)
    }
  };
};

const getInventoryIntelligence = async (
  tenantPool,
  range,
  startDateRaw,
  endDateRaw,
  deadStockDaysRaw,
  locationRaw,
  groupBy
) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);

  const deadStockDays = Math.max(Number(deadStockDaysRaw) || 60, 1);
  const lowStockThreshold = 5;

  const summaryQuery = tenantPool.query(
    `SELECT
       COALESCE(SUM(stock_quantity * COALESCE(actual_price, 0)), 0)::numeric AS total_stock_value,
       COALESCE(SUM(stock_quantity), 0)::numeric AS total_stock_quantity
     FROM products
     WHERE is_deleted = FALSE`
  );

  const lowStockQuery = tenantPool.query(
    `SELECT id AS product_id,
            name AS product_name,
            stock_quantity AS current_stock
     FROM products
     WHERE is_deleted = FALSE
       AND stock_quantity <= $1
     ORDER BY stock_quantity ASC
     LIMIT 20`,
    [lowStockThreshold]
  );

  const expirySummaryQuery = tenantPool.query(
    `SELECT
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE)::int AS expired_count,
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '7 days')::int AS expiring_7_days,
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date > CURRENT_DATE + INTERVAL '7 days' AND expiry_date <= CURRENT_DATE + INTERVAL '30 days')::int AS expiring_30_days
     FROM products
     WHERE is_deleted = FALSE`
  );

  const expiryDetailsQuery = tenantPool.query(
    `SELECT id AS product_id,
            name AS product_name,
            stock_quantity AS current_stock,
            expiry_date,
            CASE
              WHEN expiry_date < CURRENT_DATE THEN 'expired'
              WHEN expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_7_days'
              WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_30_days'
              ELSE 'valid'
            END AS expiry_status
     FROM products
     WHERE is_deleted = FALSE
       AND expiry_date IS NOT NULL
       AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
     ORDER BY expiry_date ASC NULLS LAST
     LIMIT 100`
  );

  const deadStockQuery = tenantPool.query(
    `SELECT p.id AS product_id,
            p.name AS product_name,
            p.stock_quantity AS current_stock,
            MAX(CASE WHEN $2::text IS NULL OR o.location = $2 THEN o.created_at END) AS last_sold_date,
            COALESCE(p.actual_price, 0) AS actual_price
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND o.transaction_type = 'sale'
     WHERE p.is_deleted = FALSE
     GROUP BY p.id, p.name, p.stock_quantity, p.actual_price
     HAVING MAX(CASE WHEN $2::text IS NULL OR o.location = $2 THEN o.created_at END) IS NULL
        OR MAX(CASE WHEN $2::text IS NULL OR o.location = $2 THEN o.created_at END) < NOW() - ($1::text || ' days')::interval
     ORDER BY last_sold_date NULLS FIRST
     LIMIT 50`,
    [deadStockDays, location]
  );

  const fastMovingQuery = tenantPool.query(
    `SELECT p.id AS product_id,
            p.name AS product_name,
            COALESCE(SUM(oi.quantity), 0)::numeric AS quantity_sold
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE o.created_at BETWEEN $1 AND $2
       AND o.transaction_type = 'sale'
       AND ($3::text IS NULL OR o.location = $3)
     GROUP BY p.id, p.name
     ORDER BY quantity_sold DESC
     LIMIT 5`,
    [start, end, location]
  );

  const [summaryRes, lowStockRes, deadStockRes, fastMovingRes, expirySummaryRes, expiryDetailsRes] = await Promise.all([
    summaryQuery,
    lowStockQuery,
    deadStockQuery,
    fastMovingQuery,
    expirySummaryQuery,
    expiryDetailsQuery
  ]);

  const summaryRow = summaryRes.rows[0] || {};
  const deadStockValue = deadStockRes.rows.reduce((sum, row) => {
    const price = Number(row.actual_price || 0);
    const qty = Number(row.current_stock || 0);
    return sum + price * qty;
  }, 0);

  const baseSummary = {
    total_stock_value: Number(summaryRow.total_stock_value || 0),
    total_stock_quantity: Number(summaryRow.total_stock_quantity || 0),
    dead_stock_value: Math.round(deadStockValue * 100) / 100
  };

  const expirySummaryRow = expirySummaryRes.rows[0] || {};
  const expirySummary = {
    expiring_30_days: Number(expirySummaryRow.expiring_30_days || 0),
    expiring_7_days: Number(expirySummaryRow.expiring_7_days || 0),
    expired: Number(expirySummaryRow.expired_count || 0)
  };
  const expiryDetails = expiryDetailsRes.rows.map((row) => {
    const rawDate = row.expiry_date;
    const formatted =
      rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : typeof rawDate === 'string'
        ? rawDate.slice(0, 10)
        : null;
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      current_stock: Number(row.current_stock || 0),
      expiry_date: formatted,
      status: row.expiry_status
    };
  });

  if (groupBy === 'location') {
    const groupedFastMovingRes = await tenantPool.query(
      `SELECT location, product_id, product_name, quantity_sold
       FROM (
         SELECT o.location AS location,
                p.id AS product_id,
                p.name AS product_name,
                COALESCE(SUM(oi.quantity), 0)::numeric AS quantity_sold,
                ROW_NUMBER() OVER (PARTITION BY o.location ORDER BY COALESCE(SUM(oi.quantity), 0) DESC) AS rn
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN products p ON p.id = oi.product_id
         WHERE o.created_at BETWEEN $1 AND $2
           AND o.location IS NOT NULL
           AND o.transaction_type = 'sale'
           AND ($3::text IS NULL OR o.location = $3)
         GROUP BY o.location, p.id, p.name
       ) ranked
       WHERE rn <= 5
       ORDER BY location ASC, quantity_sold DESC`,
      [start, end, location]
    );

    const grouped = new Map();
    for (const row of groupedFastMovingRes.rows) {
      if (!grouped.has(row.location)) {
        grouped.set(row.location, {
          location: row.location,
          inventory_summary: baseSummary,
          fast_moving: []
        });
      }
      grouped.get(row.location).fast_moving.push({
        product_id: row.product_id,
        product_name: row.product_name,
        quantity_sold: Number(row.quantity_sold || 0)
      });
    }

    return { grouped: Array.from(grouped.values()) };
  }

  return {
    inventory_summary: baseSummary,
    expiry_summary: expirySummary,
    expiry_details: expiryDetails,
    low_stock: lowStockRes.rows.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      current_stock: Number(row.current_stock || 0),
      min_stock_level: lowStockThreshold
    })),
    dead_stock: deadStockRes.rows.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      current_stock: Number(row.current_stock || 0),
      last_sold_date: row.last_sold_date ? row.last_sold_date.toISOString().slice(0, 10) : null
    })),
    fast_moving: fastMovingRes.rows.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      quantity_sold: Number(row.quantity_sold || 0)
    }))
  };
};

const getCustomerCredit = async (
  tenantPool,
  range,
  startDateRaw,
  endDateRaw,
  locationRaw,
  groupBy
) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);

  if (groupBy === 'location') {
    const topCustomersRes = await tenantPool.query(
      `SELECT location, customer_id, customer_name, total_revenue, total_orders
       FROM (
         SELECT o.location AS location,
                c.id AS customer_id,
                c.name AS customer_name,
                COALESCE(SUM(t.total_price), 0)::numeric AS total_revenue,
                COUNT(DISTINCT o.id)::int AS total_orders,
                ROW_NUMBER() OVER (PARTITION BY o.location ORDER BY COALESCE(SUM(t.total_price), 0) DESC) AS rn
         FROM orders o
         JOIN transactions t ON t.order_id = o.id
         JOIN customers c ON c.id = o.customer_id
         WHERE o.created_at BETWEEN $1 AND $2
           AND o.location IS NOT NULL
           AND o.transaction_type = 'sale'
           AND ($3::text IS NULL OR o.location = $3)
         GROUP BY o.location, c.id, c.name
       ) ranked
       WHERE rn <= 5
       ORDER BY location ASC, total_revenue DESC`,
      [start, end, location]
    );

    const creditSummaryRes = await tenantPool.query(
      `SELECT o.location AS location,
              COALESCE(SUM(t.total_price), 0)::numeric AS total_outstanding,
              COUNT(DISTINCT o.customer_id)::int AS customers_with_credit
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       WHERE t.payment_mode = 'credit'
         AND o.created_at BETWEEN $1 AND $2
         AND o.location IS NOT NULL
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY o.location
       ORDER BY o.location ASC`,
      [start, end, location]
    );

    const newCustomersRes = await tenantPool.query(
      `SELECT o.location AS location,
              COUNT(DISTINCT c.id)::int AS new_customers
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.created_at BETWEEN $1 AND $2
         AND c.created_at BETWEEN $1 AND $2
         AND o.location IS NOT NULL
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY o.location
       ORDER BY o.location ASC`,
      [start, end, location]
    );

    const repeatCustomersRes = await tenantPool.query(
      `SELECT location,
              COUNT(*)::int AS repeat_customers
       FROM (
         SELECT o.location AS location,
                o.customer_id
         FROM orders o
         WHERE o.created_at BETWEEN $1 AND $2
           AND o.customer_id IS NOT NULL
           AND o.location IS NOT NULL
           AND o.transaction_type = 'sale'
           AND ($3::text IS NULL OR o.location = $3)
         GROUP BY o.location, o.customer_id
         HAVING COUNT(*) > 1
       ) rc
       GROUP BY location
       ORDER BY location ASC`,
      [start, end, location]
    );

    const totalCustomersRes = await tenantPool.query(
      `SELECT o.location AS location,
              COUNT(DISTINCT o.customer_id)::int AS total_customers
       FROM orders o
       WHERE o.created_at BETWEEN $1 AND $2
         AND o.customer_id IS NOT NULL
         AND o.location IS NOT NULL
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY o.location
       ORDER BY o.location ASC`,
      [start, end, location]
    );

    const grouped = new Map();
    const ensure = (loc) => {
      if (!grouped.has(loc)) {
        grouped.set(loc, {
          location: loc,
          top_customers: [],
          credit_summary: {
            total_outstanding: 0,
            overdue_amount: 0,
            customers_with_credit: 0
          },
          customer_metrics: {
            new_customers: 0,
            repeat_customer_rate: 0
          }
        });
      }
      return grouped.get(loc);
    };

    for (const row of topCustomersRes.rows) {
      const entry = ensure(row.location);
      entry.top_customers.push({
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        total_revenue: Number(row.total_revenue || 0),
        total_orders: Number(row.total_orders || 0)
      });
    }

    for (const row of creditSummaryRes.rows) {
      const entry = ensure(row.location);
      entry.credit_summary.total_outstanding = Number(row.total_outstanding || 0);
      entry.credit_summary.customers_with_credit = Number(row.customers_with_credit || 0);
    }

    const repeatMap = new Map(
      repeatCustomersRes.rows.map((row) => [row.location, Number(row.repeat_customers || 0)])
    );
    const totalMap = new Map(
      totalCustomersRes.rows.map((row) => [row.location, Number(row.total_customers || 0)])
    );
    for (const row of newCustomersRes.rows) {
      const entry = ensure(row.location);
      entry.customer_metrics.new_customers = Number(row.new_customers || 0);
      const repeatCustomers = repeatMap.get(row.location) || 0;
      const totalCustomers = totalMap.get(row.location) || 0;
      entry.customer_metrics.repeat_customer_rate =
        totalCustomers > 0
          ? Math.round((repeatCustomers / totalCustomers) * 10000) / 100
          : 0;
    }

    return { grouped: Array.from(grouped.values()) };
  }

  const topCustomersQuery = tenantPool.query(
    `SELECT c.id AS customer_id,
            c.name AS customer_name,
            COALESCE(SUM(t.total_price), 0)::numeric AS total_revenue,
            COUNT(DISTINCT o.id)::int AS total_orders
     FROM orders o
     JOIN transactions t ON t.order_id = o.id
     JOIN customers c ON c.id = o.customer_id
     WHERE o.created_at BETWEEN $1 AND $2
       AND o.transaction_type = 'sale'
       AND ($3::text IS NULL OR o.location = $3)
     GROUP BY c.id, c.name
     ORDER BY total_revenue DESC
     LIMIT 5`,
    [start, end, location]
  );

  const creditSummaryQuery = tenantPool.query(
    `SELECT
       COALESCE(SUM(t.total_price), 0)::numeric AS total_outstanding,
       COUNT(DISTINCT o.customer_id)::int AS customers_with_credit
     FROM transactions t
     JOIN orders o ON o.id = t.order_id
     WHERE t.payment_mode = 'credit'
       AND o.created_at BETWEEN $1 AND $2
       AND o.transaction_type = 'sale'
       AND ($3::text IS NULL OR o.location = $3)`,
    [start, end, location]
  );

  const newCustomersQuery = tenantPool.query(
    `SELECT COUNT(DISTINCT c.id)::int AS new_customers
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE o.created_at BETWEEN $1 AND $2
       AND c.created_at BETWEEN $1 AND $2
       AND o.transaction_type = 'sale'
       AND ($3::text IS NULL OR o.location = $3)`,
    [start, end, location]
  );

  const repeatCustomersQuery = tenantPool.query(
    `SELECT COUNT(*)::int AS repeat_customers
     FROM (
       SELECT o.customer_id
       FROM orders o
       WHERE o.created_at BETWEEN $1 AND $2
         AND o.customer_id IS NOT NULL
         AND o.transaction_type = 'sale'
         AND ($3::text IS NULL OR o.location = $3)
       GROUP BY o.customer_id
       HAVING COUNT(*) > 1
     ) rc`,
    [start, end, location]
  );

  const totalCustomersQuery = tenantPool.query(
    `SELECT COUNT(DISTINCT o.customer_id)::int AS total_customers
     FROM orders o
     WHERE o.created_at BETWEEN $1 AND $2
       AND o.customer_id IS NOT NULL
       AND o.transaction_type = 'sale'
       AND ($3::text IS NULL OR o.location = $3)`,
    [start, end, location]
  );

  const [
    topCustomersRes,
    creditSummaryRes,
    newCustomersRes,
    repeatCustomersRes,
    totalCustomersRes
  ] = await Promise.all([
    topCustomersQuery,
    creditSummaryQuery,
    newCustomersQuery,
    repeatCustomersQuery,
    totalCustomersQuery
  ]);

  const creditRow = creditSummaryRes.rows[0] || {};
  const repeatCustomers = Number(repeatCustomersRes.rows[0]?.repeat_customers || 0);
  const totalCustomers = Number(totalCustomersRes.rows[0]?.total_customers || 0);
  const repeatRate =
    totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 10000) / 100 : 0;

  return {
    top_customers: topCustomersRes.rows.map((row) => ({
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      total_revenue: Number(row.total_revenue || 0),
      total_orders: Number(row.total_orders || 0)
    })),
    credit_summary: {
      total_outstanding: Number(creditRow.total_outstanding || 0),
      overdue_amount: 0,
      customers_with_credit: Number(creditRow.customers_with_credit || 0)
    },
    customer_metrics: {
      new_customers: Number(newCustomersRes.rows[0]?.new_customers || 0),
      repeat_customer_rate: repeatRate
    }
  };
};

const getLocationSummary = async (tenantPool, range, startDateRaw, endDateRaw, locationRaw) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);

  const windowDays = diffDays(start, end);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(start.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const result = await tenantPool.query(
    `SELECT
       location,
       COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_revenue END), 0)::numeric AS total_revenue,
       COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_profit END), 0)::numeric AS total_profit,
       COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_orders END), 0)::int AS total_orders,
       COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_revenue END), 0)::numeric AS previous_revenue
     FROM tenant_dashboard_metrics
     WHERE day BETWEEN $3 AND $2
       AND location IS NOT NULL
       AND ($5::text IS NULL OR location = $5)
     GROUP BY location
     ORDER BY location ASC`,
    [start, end, previousStart, previousEnd, location]
  );

  return result.rows.map((row) => {
    const totalRevenue = Number(row.total_revenue || 0);
    const previousRevenue = Number(row.previous_revenue || 0);
    return {
      location: row.location,
      total_revenue: totalRevenue,
      total_profit: Number(row.total_profit || 0),
      total_orders: Number(row.total_orders || 0),
      growth_percentage: percentGrowth(totalRevenue, previousRevenue)
    };
  });
};

module.exports = {
  getRevenueOverview,
  getGrowthComparison,
  getInventoryIntelligence,
  getCustomerCredit,
  normalizeLocation,
  getLocationSummary
};
