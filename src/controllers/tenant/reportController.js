const { jsonError, jsonOk } = require('../../utils/responses');

const getSalesSummary = async (req, res) => {
  try {
    const { tenantPool } = req;
    const result = await tenantPool.query(
      `SELECT COUNT(*)::int AS total_orders,
              COALESCE(SUM(total_price - COALESCE(returned_amount, 0)), 0) AS total_revenue
       FROM orders
       WHERE order_status = ANY($1::text[])`,
      [['completed', 'partially_returned', 'fully_returned']]
    );
    return jsonOk(res, result.rows[0]);
  } catch (error) {
    return jsonError(res, 500, 'REPORT_FAILED', error.message);
  }
};

module.exports = { getSalesSummary };
