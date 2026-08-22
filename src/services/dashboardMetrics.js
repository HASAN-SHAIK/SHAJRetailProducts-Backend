const { getDateRange } = require('../utils/dateRange');
const { normalizeBranchId } = require('../utils/branch');

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

const completedSaleStatusSql = "('completed', 'partially_returned', 'fully_returned')";

const rawSalesSummarySql = ({ grouped = false, previous = false } = {}) => {
  const selectLocation = grouped ? 'location,' : '';
  const locationNotNull = grouped ? 'AND location IS NOT NULL' : '';
  const datePredicate = previous
    ? `((created_at BETWEEN $1 AND $2) OR (created_at BETWEEN $3 AND $4))`
    : `created_at BETWEEN $1 AND $2`;
  const locationParam = previous ? '$5' : '$3';
  const branchParam = previous ? '$6' : '$4';
  const periodCase = previous
    ? `CASE WHEN created_at BETWEEN $1 AND $2 THEN 'current' ELSE 'previous' END AS period_key,`
    : '';
  const selectPeriod = previous ? 'period_key,' : '';
  const revenueGroupFields = [
    grouped ? 'location' : null,
    previous ? 'period_key' : null,
  ].filter(Boolean);
  const revenueGroupBy = revenueGroupFields.length > 0 ? `GROUP BY ${revenueGroupFields.join(', ')}` : '';
  const profitGroupFields = [
    grouped ? 'o.location' : null,
    previous ? 'o.period_key' : null,
  ].filter(Boolean);
  const profitGroupBy = profitGroupFields.length > 0 ? `GROUP BY ${profitGroupFields.join(', ')}` : '';

  return `WITH orders_filtered AS (
     SELECT id,location,total_price,returned_amount,${periodCase} created_at
     FROM orders
     WHERE ${datePredicate}
       AND transaction_type = 'sale'
       AND order_status IN ${completedSaleStatusSql}
       ${locationNotNull}
       AND (${locationParam}::text IS NULL OR location = ${locationParam})
       AND (${branchParam}::uuid IS NULL OR branch_id = ${branchParam})
   ),
   returned_items AS (
     SELECT r.order_id,ori.product_id,SUM(ori.quantity) AS returned_qty
     FROM order_returns r
     JOIN order_return_items ori ON ori.return_id = r.id
     JOIN orders_filtered o ON o.id = r.order_id
     GROUP BY r.order_id,ori.product_id
   ),
   revenue_summary AS (
     SELECT ${selectLocation}${selectPeriod}
            COALESCE(SUM(total_price - COALESCE(returned_amount, 0)), 0)::numeric AS total_revenue,
            COUNT(*)::int AS total_orders
     FROM orders_filtered
     ${revenueGroupBy}
   ),
   profit_summary AS (
     SELECT ${grouped ? 'o.location,' : ''}${previous ? 'o.period_key,' : ''}
            COALESCE(SUM(
              GREATEST(oi.quantity - COALESCE(ri.returned_qty, 0), 0)
              * (
                COALESCE(
                  NULLIF(oi.profit, 0),
                  (COALESCE(oi.selling_price, 0) - COALESCE(oi.purchase_price_snapshot, p.purchase_price, 0)) * oi.quantity
                ) / NULLIF(oi.quantity, 0)
              )
            ), 0)::numeric AS total_profit
     FROM orders_filtered o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN returned_items ri ON ri.order_id = o.id AND ri.product_id = oi.product_id
     ${profitGroupBy}
   )
   SELECT ${grouped ? 'r.location,' : ''}${previous ? 'r.period_key,' : ''}
          r.total_revenue,
          COALESCE(p.total_profit, 0)::numeric AS total_profit,
          r.total_orders
   FROM revenue_summary r
   LEFT JOIN profit_summary p ON ${[
     grouped ? 'p.location = r.location' : null,
     previous ? 'p.period_key = r.period_key' : null,
   ].filter(Boolean).join(' AND ') || 'TRUE'}`;
};

const loadRawSalesSummary = async (tenantPool, start, end, location, branchId) => {
  const result = await tenantPool.query(rawSalesSummarySql(), [start, end, location, branchId]);
  return result.rows[0] || {};
};

const loadRawSalesComparison = async (tenantPool, start, end, previousStart, previousEnd, location, branchId) => {
  const result = await tenantPool.query(rawSalesSummarySql({ previous: true }), [start, end, previousStart, previousEnd, location, branchId]);
  const byPeriod = new Map(result.rows.map((row) => [row.period_key, row]));
  return {
    current: byPeriod.get('current') || {},
    previous: byPeriod.get('previous') || {},
  };
};

const loadRawSalesSummaryByLocation = async (tenantPool, start, end, previousStart, previousEnd, location, branchId) => {
  const result = await tenantPool.query(
    `WITH orders_filtered AS (
       SELECT o.id,
              COALESCE(NULLIF(o.location, ''), NULLIF(b.location, ''), NULLIF(b.name, ''), o.branch_id::text) AS location,
              o.total_price,
              o.returned_amount,
              CASE WHEN o.created_at BETWEEN $1 AND $2 THEN 'current' ELSE 'previous' END AS period_key
       FROM orders o
       LEFT JOIN branches b ON b.id = o.branch_id
       WHERE ((o.created_at BETWEEN $1 AND $2) OR (o.created_at BETWEEN $3 AND $4))
         AND o.transaction_type = 'sale'
         AND o.order_status IN ${completedSaleStatusSql}
         AND COALESCE(NULLIF(o.location, ''), NULLIF(b.location, ''), NULLIF(b.name, ''), o.branch_id::text) IS NOT NULL
         AND ($5::text IS NULL OR COALESCE(NULLIF(o.location, ''), NULLIF(b.location, ''), NULLIF(b.name, ''), o.branch_id::text) = $5)
         AND ($6::uuid IS NULL OR o.branch_id = $6)
     ),
     returned_items AS (
       SELECT r.order_id,ori.product_id,SUM(ori.quantity) AS returned_qty
       FROM order_returns r
       JOIN order_return_items ori ON ori.return_id = r.id
       JOIN orders_filtered o ON o.id = r.order_id
       GROUP BY r.order_id,ori.product_id
     ),
     revenue_summary AS (
       SELECT location,period_key,
              COALESCE(SUM(total_price - COALESCE(returned_amount, 0)), 0)::numeric AS total_revenue,
              COUNT(*)::int AS total_orders
       FROM orders_filtered
       GROUP BY location,period_key
     ),
     profit_summary AS (
       SELECT o.location,o.period_key,
              COALESCE(SUM(
                GREATEST(oi.quantity - COALESCE(ri.returned_qty, 0), 0)
                * (
                  COALESCE(
                    NULLIF(oi.profit, 0),
                    (COALESCE(oi.selling_price, 0) - COALESCE(oi.purchase_price_snapshot, p.purchase_price, 0)) * oi.quantity
                  ) / NULLIF(oi.quantity, 0)
                )
              ), 0)::numeric AS total_profit
       FROM orders_filtered o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN returned_items ri ON ri.order_id = o.id AND ri.product_id = oi.product_id
       GROUP BY o.location,o.period_key
     )
     SELECT r.location,r.period_key,r.total_revenue,COALESCE(p.total_profit, 0)::numeric AS total_profit,r.total_orders
     FROM revenue_summary r
     LEFT JOIN profit_summary p ON p.location = r.location AND p.period_key = r.period_key`,
    [start, end, previousStart, previousEnd, location, branchId]
  );
  const grouped = new Map();
  for (const row of result.rows) {
    if (!grouped.has(row.location)) {
      grouped.set(row.location, { location: row.location, current: {}, previous: {} });
    }
    grouped.get(row.location)[row.period_key === 'previous' ? 'previous' : 'current'] = row;
  }
  return Array.from(grouped.values());
};

const rawSummaryHasOrders = (summary) => Number(summary?.total_orders || 0) > 0;

const summaryFromRow = (row, prefix = '') => ({
  revenue: Number(row?.[`${prefix}revenue`] ?? row?.total_revenue ?? 0),
  profit: Number(row?.[`${prefix}profit`] ?? row?.total_profit ?? 0),
  orders: Number(row?.[`${prefix}orders`] ?? row?.total_orders ?? 0),
});

const getRevenueOverview = async (
  tenantPool,
  range,
  startDateRaw,
  endDateRaw,
  locationRaw,
  branchIdRaw
) => {
  const { start, end, range: resolvedRange } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);
  const branchId = normalizeBranchId(branchIdRaw);

  const [metricsRes, rawRow] = await Promise.all([
    tenantPool.query(
      `SELECT
         COALESCE(SUM(total_revenue), 0)::numeric AS total_revenue,
         COALESCE(SUM(total_profit), 0)::numeric AS total_profit,
         COALESCE(SUM(total_orders), 0)::int AS total_orders
       FROM tenant_dashboard_metrics
       WHERE day BETWEEN $1 AND $2
         AND ($3::text IS NULL OR location = $3)
         AND ($4::uuid IS NULL OR branch_id = $4)`,
      [start, end, location, branchId]
    ),
    loadRawSalesSummary(tenantPool, start, end, location, branchId)
  ]);

  const row = metricsRes.rows[0] || {};
  const metricsOrders = Number(row.total_orders || 0);
  const rawOrders = Number(rawRow.total_orders || 0);
  const useRawOrdersFallback = metricsOrders === 0 && rawOrders > 0;
  const totalRevenue = useRawOrdersFallback ? Number(rawRow.total_revenue || 0) : Number(row.total_revenue || 0);
  const totalProfit = useRawOrdersFallback ? Number(rawRow.total_profit || 0) : Number(row.total_profit || 0);
  const totalOrders = useRawOrdersFallback ? rawOrders : metricsOrders;
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
  branchIdRaw,
  groupBy
) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);
  const branchId = normalizeBranchId(branchIdRaw);

  const windowDays = diffDays(start, end);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(start.getTime() - windowDays * 24 * 60 * 60 * 1000);

  if (groupBy === 'location') {
    const [metricsRes, rawGroups] = await Promise.all([
      tenantPool.query(
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
         AND ($6::uuid IS NULL OR branch_id = $6)
       GROUP BY location
       ORDER BY location ASC`,
        [start, end, previousStart, previousEnd, location, branchId]
      ),
      loadRawSalesSummaryByLocation(tenantPool, start, end, previousStart, previousEnd, location, branchId)
    ]);

    const rawByLocation = new Map(rawGroups.map((row) => [row.location, row]));
    const metricLocations = new Set(metricsRes.rows.map((row) => row.location));
    const rows = [
      ...metricsRes.rows,
      ...rawGroups
        .filter((row) => !metricLocations.has(row.location))
        .map((row) => ({ location: row.location, current_orders: 0, previous_orders: 0 })),
    ];

    const grouped = rows.map((row) => {
      const raw = rawByLocation.get(row.location);
      const useRawCurrent = Number(row.current_orders || 0) === 0 && rawSummaryHasOrders(raw?.current);
      const useRawPrevious = Number(row.previous_orders || 0) === 0 && rawSummaryHasOrders(raw?.previous);
      const current = useRawCurrent ? summaryFromRow(raw.current) : summaryFromRow(row, 'current_');
      const previous = useRawPrevious ? summaryFromRow(raw.previous) : summaryFromRow(row, 'previous_');

      return {
        location: row.location,
        current_period: {
          start_date: start,
          end_date: end,
          revenue: current.revenue,
          profit: current.profit,
          orders: current.orders
        },
        previous_period: {
          start_date: previousStart,
          end_date: previousEnd,
          revenue: previous.revenue,
          profit: previous.profit,
          orders: previous.orders
        },
        growth: {
          revenue_growth_percent: percentGrowth(current.revenue, previous.revenue),
          profit_growth_percent: percentGrowth(current.profit, previous.profit),
          order_growth_percent: percentGrowth(current.orders, previous.orders)
        }
      };
    });

    return { grouped };
  }

  const [metricsRes, raw] = await Promise.all([
    tenantPool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_revenue END), 0)::numeric AS current_revenue,
         COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_profit END), 0)::numeric AS current_profit,
         COALESCE(SUM(CASE WHEN day BETWEEN $1 AND $2 THEN total_orders END), 0)::int AS current_orders,
         COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_revenue END), 0)::numeric AS previous_revenue,
         COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_profit END), 0)::numeric AS previous_profit,
         COALESCE(SUM(CASE WHEN day BETWEEN $3 AND $4 THEN total_orders END), 0)::int AS previous_orders
       FROM tenant_dashboard_metrics
       WHERE day BETWEEN $3 AND $2
         AND ($5::text IS NULL OR location = $5)
         AND ($6::uuid IS NULL OR branch_id = $6)`,
      [start, end, previousStart, previousEnd, location, branchId]
    ),
    loadRawSalesComparison(tenantPool, start, end, previousStart, previousEnd, location, branchId)
  ]);

  const row = metricsRes.rows[0] || {};
  const current = Number(row.current_orders || 0) === 0 && rawSummaryHasOrders(raw.current)
    ? summaryFromRow(raw.current)
    : summaryFromRow(row, 'current_');
  const previous = Number(row.previous_orders || 0) === 0 && rawSummaryHasOrders(raw.previous)
    ? summaryFromRow(raw.previous)
    : summaryFromRow(row, 'previous_');

  return {
    current_period: {
      start_date: start,
      end_date: end,
      revenue: current.revenue,
      profit: current.profit,
      orders: current.orders
    },
    previous_period: {
      start_date: previousStart,
      end_date: previousEnd,
      revenue: previous.revenue,
      profit: previous.profit,
      orders: previous.orders
    },
    growth: {
      revenue_growth_percent: percentGrowth(current.revenue, previous.revenue),
      profit_growth_percent: percentGrowth(current.profit, previous.profit),
      order_growth_percent: percentGrowth(current.orders, previous.orders)
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
  branchIdRaw,
  groupBy
) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);
  const branchId = normalizeBranchId(branchIdRaw);

  const deadStockDays = Math.max(Number(deadStockDaysRaw) || 60, 1);
  const lowStockThreshold = 5;

  const summaryQuery = tenantPool.query(
    `SELECT
       COALESCE(SUM(stock_quantity * COALESCE(purchase_price, 0)), 0)::numeric AS total_stock_value,
       COALESCE(SUM(stock_quantity), 0)::numeric AS total_stock_quantity
     FROM products
     WHERE is_deleted = FALSE
       AND ($1::uuid IS NULL OR branch_id = $1)`,
    [branchId]
  );

  const lowStockQuery = tenantPool.query(
    `SELECT id AS product_id,
            name AS product_name,
            stock_quantity AS current_stock
     FROM products
     WHERE is_deleted = FALSE
       AND stock_quantity <= $1
       AND ($2::uuid IS NULL OR branch_id = $2)
     ORDER BY stock_quantity ASC
     LIMIT 20`,
    [lowStockThreshold, branchId]
  );

  const expirySummaryQuery = tenantPool.query(
    `SELECT
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE)::int AS expired_count,
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '7 days')::int AS expiring_7_days,
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date > CURRENT_DATE + INTERVAL '7 days' AND expiry_date <= CURRENT_DATE + INTERVAL '30 days')::int AS expiring_30_days
     FROM products
     WHERE is_deleted = FALSE
       AND ($1::uuid IS NULL OR branch_id = $1)`,
    [branchId]
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
       AND ($1::uuid IS NULL OR branch_id = $1)
     ORDER BY expiry_date ASC NULLS LAST
     LIMIT 100`
    ,
    [branchId]
  );

  const deadStockQuery = tenantPool.query(
    `SELECT p.id AS product_id,
            p.name AS product_name,
            p.stock_quantity AS current_stock,
            p.created_at AS created_at,
            MAX(CASE WHEN $2::text IS NULL OR o.location = $2 THEN o.created_at END) AS last_sold_date,
            COALESCE(p.purchase_price, 0) AS purchase_price
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND o.transaction_type = 'sale'
     WHERE p.is_deleted = FALSE
       AND ($3::uuid IS NULL OR p.branch_id = $3)
     GROUP BY p.id, p.name, p.stock_quantity, p.purchase_price, p.created_at
     HAVING (
       MAX(CASE WHEN $2::text IS NULL OR o.location = $2 THEN o.created_at END) IS NULL
       AND p.created_at < NOW() - ($1::text || ' days')::interval
     )
        OR MAX(CASE WHEN $2::text IS NULL OR o.location = $2 THEN o.created_at END) < NOW() - ($1::text || ' days')::interval
     ORDER BY last_sold_date NULLS FIRST
     LIMIT 50`,
    [deadStockDays, location, branchId]
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
       AND ($4::uuid IS NULL OR o.branch_id = $4)
     GROUP BY p.id, p.name
     ORDER BY quantity_sold DESC
     LIMIT 5`,
    [start, end, location, branchId]
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
    const price = Number(row.purchase_price || 0);
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
           AND ($4::uuid IS NULL OR o.branch_id = $4)
         GROUP BY o.location, p.id, p.name
       ) ranked
       WHERE rn <= 5
       ORDER BY location ASC, quantity_sold DESC`,
      [start, end, location, branchId]
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
  branchIdRaw,
  groupBy
) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);
  const branchId = normalizeBranchId(branchIdRaw);

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
           AND ($4::uuid IS NULL OR o.branch_id = $4)
         GROUP BY o.location, c.id, c.name
       ) ranked
       WHERE rn <= 5
       ORDER BY location ASC, total_revenue DESC`,
      [start, end, location, branchId]
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
         AND ($4::uuid IS NULL OR o.branch_id = $4)
       GROUP BY o.location
       ORDER BY o.location ASC`,
      [start, end, location, branchId]
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
         AND ($4::uuid IS NULL OR o.branch_id = $4)
       GROUP BY o.location
       ORDER BY o.location ASC`,
      [start, end, location, branchId]
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
           AND ($4::uuid IS NULL OR o.branch_id = $4)
         GROUP BY o.location, o.customer_id
         HAVING COUNT(*) > 1
       ) rc
       GROUP BY location
       ORDER BY location ASC`,
      [start, end, location, branchId]
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
         AND ($4::uuid IS NULL OR o.branch_id = $4)
       GROUP BY o.location
       ORDER BY o.location ASC`,
      [start, end, location, branchId]
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
       AND ($4::uuid IS NULL OR o.branch_id = $4)
     GROUP BY c.id, c.name
     ORDER BY total_revenue DESC
     LIMIT 5`,
    [start, end, location, branchId]
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
       AND ($3::text IS NULL OR o.location = $3)
       AND ($4::uuid IS NULL OR o.branch_id = $4)`,
    [start, end, location, branchId]
  );

  const newCustomersQuery = tenantPool.query(
    `SELECT COUNT(DISTINCT c.id)::int AS new_customers
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE o.created_at BETWEEN $1 AND $2
       AND c.created_at BETWEEN $1 AND $2
       AND o.transaction_type = 'sale'
       AND ($3::text IS NULL OR o.location = $3)
       AND ($4::uuid IS NULL OR o.branch_id = $4)`,
    [start, end, location, branchId]
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
         AND ($4::uuid IS NULL OR o.branch_id = $4)
       GROUP BY o.customer_id
       HAVING COUNT(*) > 1
    ) rc`,
    [start, end, location, branchId]
  );

  const totalCustomersQuery = tenantPool.query(
    `SELECT COUNT(DISTINCT o.customer_id)::int AS total_customers
     FROM orders o
     WHERE o.created_at BETWEEN $1 AND $2
       AND o.customer_id IS NOT NULL
       AND o.transaction_type = 'sale'
       AND ($3::text IS NULL OR o.location = $3)
       AND ($4::uuid IS NULL OR o.branch_id = $4)`,
    [start, end, location, branchId]
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

const getLocationSummary = async (
  tenantPool,
  range,
  startDateRaw,
  endDateRaw,
  locationRaw,
  branchIdRaw
) => {
  const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
  const location = normalizeLocation(locationRaw);
  const branchId = normalizeBranchId(branchIdRaw);

  const windowDays = diffDays(start, end);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(start.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [metricsRes, rawGroups] = await Promise.all([
    tenantPool.query(
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
         AND ($6::uuid IS NULL OR branch_id = $6)
       GROUP BY location
       ORDER BY location ASC`,
      [start, end, previousStart, previousEnd, location, branchId]
    ),
    loadRawSalesSummaryByLocation(tenantPool, start, end, previousStart, previousEnd, location, branchId)
  ]);

  const rawByLocation = new Map(rawGroups.map((row) => [row.location, row]));
  const metricLocations = new Set(metricsRes.rows.map((row) => row.location));
  const rows = [
    ...metricsRes.rows,
    ...rawGroups
      .filter((row) => !metricLocations.has(row.location))
      .map((row) => ({ location: row.location, total_orders: 0, previous_revenue: 0 })),
  ];

  return rows.map((row) => {
    const raw = rawByLocation.get(row.location);
    const useRawCurrent = Number(row.total_orders || 0) === 0 && rawSummaryHasOrders(raw?.current);
    const current = useRawCurrent ? summaryFromRow(raw.current) : {
      revenue: Number(row.total_revenue || 0),
      profit: Number(row.total_profit || 0),
      orders: Number(row.total_orders || 0),
    };
    const previousRevenue = rawSummaryHasOrders(raw?.previous)
      ? Number(raw.previous.total_revenue || 0)
      : Number(row.previous_revenue || 0);
    return {
      location: row.location,
      total_revenue: current.revenue,
      total_profit: current.profit,
      total_orders: current.orders,
      growth_percentage: percentGrowth(current.revenue, previousRevenue)
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

