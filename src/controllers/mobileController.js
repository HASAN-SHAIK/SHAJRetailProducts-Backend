const { jsonError, jsonOk } = require('../utils/responses');
const { buildPaginationMeta, parsePagination, parsePositiveInt } = require('../utils/queryParams');

const getRequestPool = (req) =>
  req?.tenantPool && typeof req.tenantPool.query === 'function' ? req.tenantPool : null;

const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const DEFAULT_LOW_STOCK_LIMIT = 50;
const SALES_STATUSES = ['completed', 'partially_returned', 'fully_returned'];

const requireTenantPool = (req, res) => {
  const requestPool = getRequestPool(req);
  if (!requestPool) {
    jsonError(res, 500, 'MOBILE_TENANT_POOL_REQUIRED', 'Tenant reporting database is unavailable.');
    return null;
  }
  return requestPool;
};

const getMobileDashboard = async (req, res) => {
  try {
    const requestPool = requireTenantPool(req, res);
    if (!requestPool) return res;

    const branchId = req.reportBranchId || null;
    const threshold = parsePositiveInt(req.query?.threshold, DEFAULT_LOW_STOCK_THRESHOLD);

    const todayQuery = requestPool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN order_status = ANY($1::text[]) THEN (total_price - COALESCE(returned_amount, 0)) END), 0)::numeric AS today_sales,
         COUNT(*) FILTER (WHERE order_status = ANY($1::text[]))::int AS today_orders
       FROM orders
       WHERE transaction_type = 'sale'
         AND created_at >= CURRENT_DATE
         AND created_at < (CURRENT_DATE + INTERVAL '1 day')
         AND ($2::uuid IS NULL OR branch_id = $2)`,
      [SALES_STATUSES, branchId]
    );

    const profitQuery = requestPool.query(
      `SELECT
         COALESCE(SUM(
           GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
           * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
         ), 0)::numeric AS today_profit
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN (
         SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
         FROM order_returns r
         JOIN order_return_items ori ON ori.return_id = r.id
         GROUP BY r.order_id, ori.product_id
       ) r ON r.order_id = o.id AND r.product_id = oi.product_id
       WHERE o.transaction_type = 'sale'
         AND o.order_status = ANY($1::text[])
         AND o.created_at >= CURRENT_DATE
         AND o.created_at < (CURRENT_DATE + INTERVAL '1 day')
         AND ($2::uuid IS NULL OR o.branch_id = $2)`,
      [SALES_STATUSES, branchId]
    );

    const recentOrdersQuery = requestPool.query(
      `SELECT
          o.id,
          o.total_price AS total,
          o.order_status AS status,
          o.created_at,
          COALESCE(o.product_count, SUM(oi.quantity))::numeric AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.transaction_type = 'sale'
         AND ($1::uuid IS NULL OR o.branch_id = $1)
       GROUP BY o.id, o.total_price, o.order_status, o.created_at, o.product_count
       ORDER BY o.created_at DESC
       LIMIT 5`,
      [branchId]
    );

    // The certified V1 branch inventory source still has an explicit unresolved
    // physical/sellable/provisional-deficit contract. Do not leak tenant-wide
    // product stock into a branch-scoped mobile dashboard while that remains open.
    const lowStockQuery = branchId
      ? Promise.resolve({ rows: [{ low_stock_count: null }] })
      : requestPool.query(
          `SELECT COUNT(*)::int AS low_stock_count
           FROM products
           WHERE is_deleted = FALSE
             AND stock_quantity <= $1`,
          [threshold]
        );

    const [todayRes, profitRes, lowStockRes, recentOrdersRes] = await Promise.all([
      todayQuery,
      profitQuery,
      lowStockQuery,
      recentOrdersQuery,
    ]);

    const todayRow = todayRes.rows[0] || {};
    const profitRow = profitRes.rows[0] || {};
    const lowStockRow = lowStockRes.rows[0] || {};

    return jsonOk(res, {
      today_sales: Number(todayRow.today_sales || 0),
      today_orders: Number(todayRow.today_orders || 0),
      today_profit: Number(profitRow.today_profit || 0),
      low_stock_count:
        lowStockRow.low_stock_count === null || lowStockRow.low_stock_count === undefined
          ? null
          : Number(lowStockRow.low_stock_count || 0),
      inventory_scope: branchId ? 'branch_inventory_unavailable' : 'tenant',
      recent_orders: recentOrdersRes.rows.map((row) => ({
        id: row.id,
        total: Number(row.total || 0),
        items: Number(row.items || 0),
        status: row.status,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    console.error('Mobile dashboard failed:', error);
    return jsonError(res, 500, 'MOBILE_DASHBOARD_FAILED', 'Internal server error');
  }
};

const getMobileLowStock = async (req, res) => {
  try {
    const requestPool = requireTenantPool(req, res);
    if (!requestPool) return res;

    if (req.reportBranchId) {
      return jsonError(
        res,
        403,
        'REPORT_INVENTORY_BRANCH_SCOPE_REQUIRED',
        'Branch-scoped inventory reporting is not yet available.'
      );
    }

    const threshold = parsePositiveInt(req.query?.threshold, DEFAULT_LOW_STOCK_THRESHOLD);
    const { page, limit, offset } = parsePagination(req, {
      defaultLimit: DEFAULT_LOW_STOCK_LIMIT,
      maxLimit: 200,
    });

    const countRes = await requestPool.query(
      `SELECT COUNT(*)::int AS total
       FROM products
       WHERE is_deleted = FALSE
         AND stock_quantity <= $1`,
      [threshold]
    );
    const total = Number(countRes.rows[0]?.total || 0);

    const productsRes = await requestPool.query(
      `SELECT id,
              name,
              stock_quantity AS stock
       FROM products
       WHERE is_deleted = FALSE
         AND stock_quantity <= $1
       ORDER BY stock_quantity ASC
       LIMIT $2 OFFSET $3`,
      [threshold, limit, offset]
    );

    return jsonOk(
      res,
      {
        products: productsRes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          stock: Number(row.stock || 0),
          threshold,
        })),
      },
      null,
      buildPaginationMeta({ page, limit, total })
    );
  } catch (error) {
    console.error('Mobile low stock failed:', error);
    return jsonError(res, 500, 'MOBILE_LOW_STOCK_FAILED', 'Internal server error');
  }
};

const getMobileSalesSummary = async (req, res) => {
  try {
    const requestPool = requireTenantPool(req, res);
    if (!requestPool) return res;

    const branchId = req.reportBranchId || null;
    const summaryRes = await requestPool.query(
      `SELECT
         COALESCE(SUM(CASE
           WHEN created_at >= CURRENT_DATE
            AND created_at < CURRENT_DATE + INTERVAL '1 day'
            AND order_status = ANY($1::text[])
           THEN (total_price - COALESCE(returned_amount, 0)) END), 0)::numeric AS today,
         COALESCE(SUM(CASE
           WHEN created_at >= CURRENT_DATE - INTERVAL '1 day'
            AND created_at < CURRENT_DATE
            AND order_status = ANY($1::text[])
           THEN (total_price - COALESCE(returned_amount, 0)) END), 0)::numeric AS yesterday,
         COALESCE(SUM(CASE
           WHEN created_at >= date_trunc('week', CURRENT_DATE)
            AND created_at < date_trunc('week', CURRENT_DATE) + INTERVAL '7 day'
            AND order_status = ANY($1::text[])
           THEN (total_price - COALESCE(returned_amount, 0)) END), 0)::numeric AS week,
         COALESCE(SUM(CASE
           WHEN created_at >= date_trunc('month', CURRENT_DATE)
            AND created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
            AND order_status = ANY($1::text[])
           THEN (total_price - COALESCE(returned_amount, 0)) END), 0)::numeric AS month
       FROM orders
       WHERE transaction_type = 'sale'
         AND ($2::uuid IS NULL OR branch_id = $2)`,
      [SALES_STATUSES, branchId]
    );

    const row = summaryRes.rows[0] || {};
    return jsonOk(res, {
      today: Number(row.today || 0),
      yesterday: Number(row.yesterday || 0),
      week: Number(row.week || 0),
      month: Number(row.month || 0),
    });
  } catch (error) {
    console.error('Mobile sales summary failed:', error);
    return jsonError(res, 500, 'MOBILE_SALES_SUMMARY_FAILED', 'Internal server error');
  }
};

module.exports = {
  getMobileDashboard,
  getMobileLowStock,
  getMobileSalesSummary,
};
