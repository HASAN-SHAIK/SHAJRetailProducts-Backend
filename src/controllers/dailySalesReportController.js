const pool = require('../db');
const { getAuthUser } = require('../utils/auth');

const SALES_STATUSES = ['completed', 'partially_returned', 'fully_returned'];
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const getRequestPool = (req) => req.tenantPool || pool;
const getReportBranchId = (req) => req.reportBranchId || null;

const formatDateUtc = (dateObj) => {
  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getUtcDayRange = (dateInput) => {
  if (dateInput !== undefined && !DATE_ONLY_RE.test(dateInput)) {
    return null;
  }

  const now = new Date();
  const date = dateInput || formatDateUtc(now);
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || formatDateUtc(start) !== date) {
    return null;
  }

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { date, start, end };
};

const getDailySalesReport = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = getReportBranchId(req);
    const decoded = getAuthUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Access Denied' });
    }

    const range = getUtcDayRange(req.query?.date);
    if (!range) {
      return res.status(400).json({ message: 'Invalid date. Use YYYY-MM-DD.' });
    }

    const values = [range.start, range.end, SALES_STATUSES, branchId];
    const salesResult = await requestPool.query(
      `SELECT COALESCE(SUM(o.total_price - COALESCE(o.returned_amount, 0)), 0) AS total_revenue
       FROM orders o
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at >= $1
         AND o.created_at < $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
      values
    );

    const totalOrderRes = await requestPool.query(
      `SELECT COUNT(*) AS total_orders
       FROM orders o
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at >= $1
         AND o.created_at < $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
      values
    );

    const bestSellingProducts = await requestPool.query(
      `SELECT p.name,
              SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)) AS total_sold
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       JOIN orders o ON oi.order_id = o.id
       LEFT JOIN (
         SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
         FROM order_returns r
         JOIN order_return_items ori ON ori.return_id = r.id
         GROUP BY r.order_id, ori.product_id
       ) r ON r.order_id = o.id AND r.product_id = oi.product_id
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at >= $1
         AND o.created_at < $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)
       GROUP BY p.name
       ORDER BY total_sold DESC;`,
      values
    );

    const profitResult = await requestPool.query(
      `SELECT COALESCE(SUM(
          GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
          * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
       ), 0) AS total_profit
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN (
         SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
         FROM order_returns r
         JOIN order_return_items ori ON ori.return_id = r.id
         GROUP BY r.order_id, ori.product_id
       ) r ON r.order_id = o.id AND r.product_id = oi.product_id
       WHERE o.order_status = ANY($3::text[])
         AND o.created_at >= $1
         AND o.created_at < $2
         AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
      values
    );

    return res.json({
      date: range.date,
      total_revenue: salesResult.rows[0]?.total_revenue || 0,
      profit: profitResult.rows[0]?.total_profit || 0,
      total_orders: totalOrderRes.rows[0]?.total_orders || 0,
      best_selling_products: bestSellingProducts.rows,
    });
  } catch (error) {
    console.error('Error fetching daily sales report:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { getDailySalesReport, getUtcDayRange };
