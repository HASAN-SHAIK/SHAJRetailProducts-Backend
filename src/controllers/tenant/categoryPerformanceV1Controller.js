const { jsonError, jsonOk } = require('../../utils/responses');
const { getDateRange } = require('../../utils/dateRange');

const categoryNameSql = `COALESCE(NULLIF(oi.category_name_snapshot, ''), 'Unattributed')`;
const categoryIdSql = `NULLIF(oi.category_id_snapshot, '')`;
const productIdentitySql = `COALESCE(
  NULLIF(oi.source_product_id, ''),
  oi.product_id::text,
  NULLIF(oi.sku_snapshot, ''),
  NULLIF(oi.barcode_snapshot, ''),
  NULLIF(oi.product_name_snapshot, ''),
  'order-item:' || oi.id::text
)`;
const productNameSql = `COALESCE(
  MAX(NULLIF(oi.product_name_snapshot, '')),
  MAX(NULLIF(oi.sku_snapshot, '')),
  MAX(NULLIF(oi.barcode_snapshot, '')),
  MAX(NULLIF(oi.source_product_id, '')),
  'Unknown product'
)`;

const returnedQuantityJoin = `
  LEFT JOIN (
    SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
    FROM order_returns r
    JOIN order_return_items ori ON ori.return_id = r.id
    GROUP BY r.order_id, ori.product_id
  ) r ON r.order_id = o.id AND r.product_id = oi.product_id`;

const netQuantitySql = `GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)`;
const revenueSql = `${netQuantitySql} * oi.selling_price`;
const reportableSaleStatusSql = "('completed', 'partially_returned', 'fully_returned')";

const getCategoryPerformance = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');
    }

    const { range, start_date: startDateRaw, end_date: endDateRaw, location, group_by } = req.query || {};
    const { start, end, range: resolvedRange } = getDateRange(range, startDateRaw, endDateRaw);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }

    if (group_by === 'location') {
      const [categoryRes, topQtyRes, topRevenueRes] = await Promise.all([
        req.tenantPool.query(
          `SELECT o.location AS location,
                  ${categoryIdSql} AS category_id,
                  ${categoryNameSql} AS category_name,
                  COALESCE(SUM(${revenueSql}), 0)::numeric AS revenue
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           ${returnedQuantityJoin}
           WHERE o.created_at BETWEEN $1 AND $2
             AND o.location IS NOT NULL
             AND o.transaction_type = 'sale'
             AND o.order_status IN ${reportableSaleStatusSql}
             AND ($3::text IS NULL OR o.location = $3)
           GROUP BY o.location, ${categoryIdSql}, ${categoryNameSql}
           ORDER BY o.location ASC, revenue DESC`,
          [start, end, location || null]
        ),
        req.tenantPool.query(
          `SELECT location, product_id, product_name, category_id, category_name, quantity_sold, revenue
           FROM (
             SELECT o.location AS location,
                    ${productIdentitySql} AS product_id,
                    ${productNameSql} AS product_name,
                    ${categoryIdSql} AS category_id,
                    ${categoryNameSql} AS category_name,
                    COALESCE(SUM(${netQuantitySql}), 0)::numeric AS quantity_sold,
                    COALESCE(SUM(${revenueSql}), 0)::numeric AS revenue,
                    ROW_NUMBER() OVER (PARTITION BY o.location ORDER BY COALESCE(SUM(${netQuantitySql}), 0) DESC) AS rn
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             ${returnedQuantityJoin}
             WHERE o.created_at BETWEEN $1 AND $2
               AND o.location IS NOT NULL
               AND o.transaction_type = 'sale'
               AND o.order_status IN ${reportableSaleStatusSql}
               AND ($3::text IS NULL OR o.location = $3)
             GROUP BY o.location, ${productIdentitySql}, ${categoryIdSql}, ${categoryNameSql}
           ) ranked
           WHERE rn <= 5
           ORDER BY location ASC, quantity_sold DESC`,
          [start, end, location || null]
        ),
        req.tenantPool.query(
          `SELECT location, product_id, product_name, category_id, category_name, quantity_sold, revenue
           FROM (
             SELECT o.location AS location,
                    ${productIdentitySql} AS product_id,
                    ${productNameSql} AS product_name,
                    ${categoryIdSql} AS category_id,
                    ${categoryNameSql} AS category_name,
                    COALESCE(SUM(${netQuantitySql}), 0)::numeric AS quantity_sold,
                    COALESCE(SUM(${revenueSql}), 0)::numeric AS revenue,
                    ROW_NUMBER() OVER (PARTITION BY o.location ORDER BY COALESCE(SUM(${revenueSql}), 0) DESC) AS rn
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
             ${returnedQuantityJoin}
             WHERE o.created_at BETWEEN $1 AND $2
               AND o.location IS NOT NULL
               AND o.transaction_type = 'sale'
               AND o.order_status IN ${reportableSaleStatusSql}
               AND ($3::text IS NULL OR o.location = $3)
             GROUP BY o.location, ${productIdentitySql}, ${categoryIdSql}, ${categoryNameSql}
           ) ranked
           WHERE rn <= 5
           ORDER BY location ASC, revenue DESC`,
          [start, end, location || null]
        )
      ]);

      const grouped = new Map();
      const totals = new Map();
      for (const row of categoryRes.rows) {
        const loc = row.location;
        totals.set(loc, (totals.get(loc) || 0) + Number(row.revenue || 0));
        if (!grouped.has(loc)) {
          grouped.set(loc, {
            location: loc,
            category_performance: [],
            top_products_by_quantity: [],
            top_products_by_revenue: []
          });
        }
      }

      for (const row of categoryRes.rows) {
        const entry = grouped.get(row.location);
        const revenue = Number(row.revenue || 0);
        const totalRevenue = totals.get(row.location) || 0;
        entry.category_performance.push({
          category_id: row.category_id || null,
          category_name: row.category_name,
          revenue,
          percentage: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 10000) / 100 : 0
        });
      }

      for (const row of topQtyRes.rows) {
        grouped.get(row.location)?.top_products_by_quantity.push({
          product_id: row.product_id,
          product_name: row.product_name,
          category_name: row.category_name,
          quantity_sold: Number(row.quantity_sold || 0),
          revenue: Number(row.revenue || 0)
        });
      }

      for (const row of topRevenueRes.rows) {
        grouped.get(row.location)?.top_products_by_revenue.push({
          product_id: row.product_id,
          product_name: row.product_name,
          category_name: row.category_name,
          quantity_sold: Number(row.quantity_sold || 0),
          revenue: Number(row.revenue || 0)
        });
      }

      return jsonOk(res, {
        range: resolvedRange,
        group_by: 'location',
        category_attribution: 'sale_snapshot',
        grouped: Array.from(grouped.values())
      });
    }

    const params = location ? [start, end, location] : [start, end];
    const locationPredicate = location ? 'AND o.location = $3' : '';

    const [categoryRes, topQtyRes, topRevenueRes] = await Promise.all([
      req.tenantPool.query(
        `SELECT ${categoryIdSql} AS category_id,
                ${categoryNameSql} AS category_name,
                COALESCE(SUM(${revenueSql}), 0)::numeric AS revenue
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         ${returnedQuantityJoin}
         WHERE o.created_at BETWEEN $1 AND $2
           AND o.transaction_type = 'sale'
           AND o.order_status IN ${reportableSaleStatusSql}
           ${locationPredicate}
         GROUP BY ${categoryIdSql}, ${categoryNameSql}
         ORDER BY revenue DESC`,
        params
      ),
      req.tenantPool.query(
        `SELECT ${productIdentitySql} AS product_id,
                ${productNameSql} AS product_name,
                ${categoryNameSql} AS category_name,
                COALESCE(SUM(${netQuantitySql}), 0)::numeric AS quantity_sold,
                COALESCE(SUM(${revenueSql}), 0)::numeric AS revenue
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         ${returnedQuantityJoin}
         WHERE o.created_at BETWEEN $1 AND $2
           AND o.transaction_type = 'sale'
           AND o.order_status IN ${reportableSaleStatusSql}
           ${locationPredicate}
         GROUP BY ${productIdentitySql}, ${categoryIdSql}, ${categoryNameSql}
         ORDER BY quantity_sold DESC
         LIMIT 5`,
        params
      ),
      req.tenantPool.query(
        `SELECT ${productIdentitySql} AS product_id,
                ${productNameSql} AS product_name,
                ${categoryNameSql} AS category_name,
                COALESCE(SUM(${netQuantitySql}), 0)::numeric AS quantity_sold,
                COALESCE(SUM(${revenueSql}), 0)::numeric AS revenue
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         ${returnedQuantityJoin}
         WHERE o.created_at BETWEEN $1 AND $2
           AND o.transaction_type = 'sale'
           AND o.order_status IN ${reportableSaleStatusSql}
           ${locationPredicate}
         GROUP BY ${productIdentitySql}, ${categoryIdSql}, ${categoryNameSql}
         ORDER BY revenue DESC
         LIMIT 5`,
        params
      )
    ]);

    const totalRevenue = categoryRes.rows.reduce(
      (sum, row) => sum + Number(row.revenue || 0),
      0
    );

    const categoryPerformance = categoryRes.rows.map((row) => {
      const revenue = Number(row.revenue || 0);
      return {
        category_id: row.category_id || null,
        category_name: row.category_name,
        revenue,
        percentage: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 10000) / 100 : 0
      };
    });

    return jsonOk(res, {
      range: resolvedRange,
      category_attribution: 'sale_snapshot',
      categories: categoryPerformance,
      category_performance: categoryPerformance,
      top_products_by_quantity: topQtyRes.rows.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        category_name: row.category_name,
        quantity_sold: Number(row.quantity_sold || 0),
        revenue: Number(row.revenue || 0)
      })),
      top_products_by_revenue: topRevenueRes.rows.map((row) => ({
        product_id: row.product_id,
        product_name: row.product_name,
        category_name: row.category_name,
        quantity_sold: Number(row.quantity_sold || 0),
        revenue: Number(row.revenue || 0)
      }))
    });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'CATEGORY_PERFORMANCE_FAILED', 'Failed to load category performance');
  }
};

module.exports = { getCategoryPerformance };
