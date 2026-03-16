const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;

const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const DEFAULT_LOW_STOCK_LIMIT = 50;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const getMobileDashboard = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const threshold = parsePositiveInt(req.query?.threshold, DEFAULT_LOW_STOCK_THRESHOLD);

    const [todayRes, profitRes, lowStockRes, recentOrdersRes] = await Promise.all([
      requestPool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN order_status = 'completed' THEN total_price END), 0)::numeric AS today_sales,
           COUNT(*)::int AS today_orders
         FROM orders
         WHERE transaction_type = 'sale'
           AND created_at >= CURRENT_DATE
           AND created_at < (CURRENT_DATE + INTERVAL '1 day')`
      ),
      requestPool.query(
        `SELECT
           COALESCE(SUM((oi.selling_price - p.actual_price) * oi.quantity), 0)::numeric AS today_profit
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN products p ON p.id = oi.product_id
         WHERE o.transaction_type = 'sale'
           AND o.order_status = 'completed'
           AND o.created_at >= CURRENT_DATE
           AND o.created_at < (CURRENT_DATE + INTERVAL '1 day')`
      ),
      requestPool.query(
        `SELECT COUNT(*)::int AS low_stock_count
         FROM products
         WHERE is_deleted = FALSE
           AND stock_quantity <= $1`,
        [threshold]
      ),
      requestPool.query(
        `SELECT
            o.id,
            o.total_price AS total,
            o.order_status AS status,
            o.created_at,
            COALESCE(o.product_count, SUM(oi.quantity))::numeric AS items
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE o.transaction_type = 'sale'
         GROUP BY o.id, o.total_price, o.order_status, o.created_at, o.product_count
         ORDER BY o.created_at DESC
         LIMIT 5`
      )
    ]);

    const todayRow = todayRes.rows[0] || {};
    const profitRow = profitRes.rows[0] || {};
    const lowStockRow = lowStockRes.rows[0] || {};

    res.json({
      today_sales: Number(todayRow.today_sales || 0),
      today_orders: Number(todayRow.today_orders || 0),
      today_profit: Number(profitRow.today_profit || 0),
      low_stock_count: Number(lowStockRow.low_stock_count || 0),
      recent_orders: recentOrdersRes.rows.map((row) => ({
        id: row.id,
        total: Number(row.total || 0),
        items: Number(row.items || 0),
        status: row.status,
        created_at: row.created_at
      }))
    });
  } catch (error) {
    console.error('Mobile dashboard failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getMobileLowStock = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const threshold = parsePositiveInt(req.query?.threshold, DEFAULT_LOW_STOCK_THRESHOLD);
    const limit = parsePositiveInt(req.query?.limit, DEFAULT_LOW_STOCK_LIMIT);

    const productsRes = await requestPool.query(
      `SELECT id,
              name,
              stock_quantity AS stock
       FROM products
       WHERE is_deleted = FALSE
         AND stock_quantity <= $1
       ORDER BY stock_quantity ASC
       LIMIT $2`,
      [threshold, limit]
    );

    res.json({
      products: productsRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        stock: Number(row.stock || 0),
        threshold
      }))
    });
  } catch (error) {
    console.error('Mobile low stock failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getMobileSalesSummary = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const summaryRes = await requestPool.query(
      `SELECT
         COALESCE(SUM(CASE
           WHEN created_at >= CURRENT_DATE
            AND created_at < CURRENT_DATE + INTERVAL '1 day'
            AND order_status = 'completed'
           THEN total_price END), 0)::numeric AS today,
         COALESCE(SUM(CASE
           WHEN created_at >= CURRENT_DATE - INTERVAL '1 day'
            AND created_at < CURRENT_DATE
            AND order_status = 'completed'
           THEN total_price END), 0)::numeric AS yesterday,
         COALESCE(SUM(CASE
           WHEN created_at >= date_trunc('week', CURRENT_DATE)
            AND created_at < date_trunc('week', CURRENT_DATE) + INTERVAL '7 day'
            AND order_status = 'completed'
           THEN total_price END), 0)::numeric AS week,
         COALESCE(SUM(CASE
           WHEN created_at >= date_trunc('month', CURRENT_DATE)
            AND created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
            AND order_status = 'completed'
           THEN total_price END), 0)::numeric AS month
       FROM orders
       WHERE transaction_type = 'sale'`
    );

    const row = summaryRes.rows[0] || {};
    res.json({
      today: Number(row.today || 0),
      yesterday: Number(row.yesterday || 0),
      week: Number(row.week || 0),
      month: Number(row.month || 0)
    });
  } catch (error) {
    console.error('Mobile sales summary failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getMobileDashboard,
  getMobileLowStock,
  getMobileSalesSummary
};
