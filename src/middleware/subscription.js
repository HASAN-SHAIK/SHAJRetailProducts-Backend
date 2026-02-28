const masterPool = require('../db/masterPool');
const { jsonError } = require('../utils/responses');

const subscriptionMiddleware = async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');

    const subRes = await masterPool.query(
      `SELECT s.payment_status, s.end_date, s.start_date, s.plan_id, p.name AS plan_name
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1
         AND s.payment_status = 'paid'
         AND s.end_date IS NOT NULL
       ORDER BY s.end_date DESC NULLS LAST, s.id DESC
       LIMIT 1`,
      [tenantId]
    );
    if (subRes.rowCount === 0) {
      return jsonError(res, 402, 'SUBSCRIPTION_REQUIRED', 'No active subscription');
    }

    const subscription = subRes.rows[0];
    const now = new Date();
    const isExpired = subscription.end_date ? new Date(subscription.end_date) < now : true;
    if (isExpired) {
      return jsonError(res, 402, 'SUBSCRIPTION_INACTIVE', 'Subscription inactive');
    }

    req.subscription = subscription;
    return next();
  } catch (error) {
    return jsonError(res, 500, 'SUBSCRIPTION_CHECK_FAILED', 'Failed to validate subscription');
  }
};

module.exports = { subscriptionMiddleware };
