const pool = require('../db');
const { buildPaginationMeta, parsePagination } = require('../utils/queryParams');

const getRequestPool = (req) => req.tenantPool || pool;

const getCustomerOutstandingReport = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const countResult = await requestPool.query(
      `SELECT COUNT(*)::int AS total
       FROM customers
       WHERE COALESCE(current_balance, 0) > 0`
    );

    const result = await requestPool.query(
      `SELECT id,
              name,
              COALESCE(phone, mobile) AS phone,
              COALESCE(current_balance, 0)::numeric AS current_balance,
              COALESCE(credit_limit, 0)::numeric AS credit_limit,
              is_active,
              updated_at
       FROM customers
       WHERE COALESCE(current_balance, 0) > 0
       ORDER BY current_balance DESC, id ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.status(200).json({
      success: true,
      customers: result.rows,
      pagination: buildPaginationMeta({
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
      }),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { getCustomerOutstandingReport };
