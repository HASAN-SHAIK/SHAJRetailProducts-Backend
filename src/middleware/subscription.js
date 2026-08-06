const masterPool = require('../db/masterPool');
const { jsonError } = require('../utils/responses');
const {
  getCachedSubscription,
  setCachedSubscription
} = require('../config/subscriptionCache');

const subscriptionMiddleware = async (req, res, next) => {
  try {
    const publicTenantStatusPaths = new Set(['/tenant/me', '/banner']);
    if (publicTenantStatusPaths.has(req.path)) {
      return next();
    }

    const tenantId = req.user?.tenant_id;
    if (!tenantId) return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');

    let subscription = getCachedSubscription(tenantId);
    if (!subscription) {
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
      subscription = subRes.rows[0];
      setCachedSubscription(tenantId, subscription);
    }
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
