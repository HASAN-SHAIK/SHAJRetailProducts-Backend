const masterPool = require('../db/masterPool');
const { jsonError, jsonOk } = require('../utils/responses');

const loadActiveSubscription = async (tenantId) => {
  const subscriptionRes = await masterPool.query(
    `SELECT s.start_date, s.end_date, s.plan_id, p.name AS plan_name
     FROM subscriptions s
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = $1
       AND s.payment_status = 'paid'
       AND s.end_date IS NOT NULL
     ORDER BY s.end_date DESC NULLS LAST, s.id DESC
     LIMIT 1`,
    [tenantId]
  );

  if (subscriptionRes.rowCount === 0) return null;
  return subscriptionRes.rows[0];
};

const buildSubscriptionStatus = (row) => {
  if (!row) {
    return {
      plan_name: null,
      start_date: null,
      end_date: null,
      days_left: 0,
      is_expiring: false,
      is_urgent: false,
      is_expired: true
    };
  }

  const endDate = row.end_date ? new Date(row.end_date) : null;
  const now = new Date();
  let daysLeft = endDate ? Math.ceil((endDate - now) / (24 * 60 * 60 * 1000)) : 0;
  if (Number.isNaN(daysLeft) || daysLeft < 0) daysLeft = 0;

  return {
    plan_name: row.plan_name ?? null,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    days_left: daysLeft,
    is_expiring: daysLeft <= 7 && daysLeft > 0,
    is_urgent: daysLeft <= 3 && daysLeft > 0,
    is_expired: daysLeft <= 0
  };
};

const getTenantMe = async (req, res) => {
  try {
    const tenant = req.tenant;
    if (!tenant) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant context');
    }

    const subscriptionRow = await loadActiveSubscription(tenant.id);
    const subscription = buildSubscriptionStatus(subscriptionRow);

    return jsonOk(res, {
      id: tenant.id,
      shop_name: tenant.shop_name,
      gst_mode: tenant.gst_mode || 'INCLUSIVE',
      subscription,
      features: req.featureFlags || {}
    });
  } catch (error) {
    return jsonError(res, 500, 'TENANT_ME_FAILED', 'Failed to load tenant profile');
  }
};

const getPlatformBanner = async (req, res) => {
  try {
    const tenant = req.tenant;
    if (!tenant) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant context');
    }

    const subscriptionRow = await loadActiveSubscription(tenant.id);
    const status = buildSubscriptionStatus(subscriptionRow);
    const daysLeft = status.days_left;
    const showBanner = daysLeft <= 7;
    let bannerColor = '#F59E0B';
    if (daysLeft <= 3) {
      bannerColor = '#DC2626';
    } else if (daysLeft <= 5) {
      bannerColor = '#F97316';
    } else if (daysLeft <= 7) {
      bannerColor = '#F59E0B';
    }

    return jsonOk(res, {
      show_banner: showBanner,
      color: showBanner ? bannerColor : null,
      days_left: daysLeft,
      showBanner,
      bannerColor: showBanner ? bannerColor : null,
      daysLeft
    });
  } catch (error) {
    return jsonError(res, 500, 'BANNER_FAILED', 'Failed to load banner');
  }
};

module.exports = { getTenantMe, getPlatformBanner };
