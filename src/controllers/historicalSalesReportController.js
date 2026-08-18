const { getAuthUser } = require('../utils/auth');
const pool = require('../db');

const SALES_STATUSES = ['completed', 'partially_returned', 'fully_returned'];

const getPreviousMonthRangeUtc = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const previousMonth = month === 0 ? 11 : month - 1;
  const previousYear = month === 0 ? year - 1 : year;
  return {
    start: new Date(Date.UTC(previousYear, previousMonth, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(previousYear, previousMonth + 1, 0, 23, 59, 59, 999)),
  };
};

const getRequestPool = (req) => req.tenantPool || pool;
const getReportBranchId = (req) => req.reportBranchId || null;

const returnedQuantityJoin = `
  LEFT JOIN (
    SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
    FROM order_returns r
    JOIN order_return_items ori ON ori.return_id = r.id
    GROUP BY r.order_id, ori.product_id
  ) r ON r.order_id = o.id AND r.product_id = oi.product_id`;

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
  MAX(p.name),
  MAX(NULLIF(oi.sku_snapshot, '')),
  MAX(NULLIF(oi.barcode_snapshot, '')),
  MAX(NULLIF(oi.source_product_id, '')),
  'Unknown product'
)`;

const getHistoricalSalesReport = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = getReportBranchId(req);
    const decoded = getAuthUser(req);
    if (!decoded) return res.status(401).json({ message: 'Access Denied' });

    let { from_date: fromDate, to_date: toDate } = req.query || {};
    if (!fromDate || !toDate) {
      const range = getPreviousMonthRangeUtc();
      fromDate = range.start;
      toDate = range.end;
    }

    const summary = await requestPool.query(
      `SELECT
         COALESCE(SUM(o.total_price - COALESCE(o.returned_amount, 0)), 0) AS total_revenue,
         COUNT(*) AS total_orders
       FROM orders o
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at BETWEEN $1 AND $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
      [fromDate, toDate, SALES_STATUSES, branchId]
    );

    const profit = await requestPool.query(
      `SELECT COALESCE(SUM(
         GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
         * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
       ), 0) AS total_profit
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       ${returnedQuantityJoin}
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at BETWEEN $1 AND $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
      [fromDate, toDate, SALES_STATUSES, branchId]
    );

    const bestSellingProducts = await requestPool.query(
      `SELECT
         SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)) AS "NoOfSold",
         SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
             * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))) AS "Profit",
         ${productNameSql} AS "Name",
         MAX(p.company) AS "Company"
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       ${returnedQuantityJoin}
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at BETWEEN $1 AND $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)
       GROUP BY ${productIdentitySql}
       ORDER BY "NoOfSold" DESC
       LIMIT 20;`,
      [fromDate, toDate, SALES_STATUSES, branchId]
    );

    const profitByProduct = await requestPool.query(
      `SELECT
         SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)) AS "NoOfSold",
         SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
             * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))) AS "Profit",
         ${productNameSql} AS "Name",
         MAX(p.company) AS "Company",
         MAX(COALESCE(oi.unit_price_minor::numeric / 100.0, oi.selling_price)) AS "Price"
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       ${returnedQuantityJoin}
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at BETWEEN $1 AND $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)
       GROUP BY ${productIdentitySql}
       ORDER BY "Profit" DESC
       LIMIT 20;`,
      [fromDate, toDate, SALES_STATUSES, branchId]
    );

    return res.json({
      total_revenue: summary.rows[0]?.total_revenue || 0,
      total_orders: summary.rows[0]?.total_orders || 0,
      totalProfit: profit.rows[0]?.total_profit || 0,
      bestSellingProducts: bestSellingProducts.rows,
      profitByProduct: profitByProduct.rows,
    });
  } catch (error) {
    console.error('Error fetching historical sales report:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getHistoricalSalesReport,
};
