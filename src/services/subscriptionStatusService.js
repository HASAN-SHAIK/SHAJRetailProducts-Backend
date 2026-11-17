const masterPool = require('../db/masterPool');

// payment_status values that grant tenant access while end_date is in the future.
// 'trial' = free self-serve trial (amount 0); 'paid' = paid plan. Never counted as revenue.
const ACCESS_PAYMENT_STATUSES = ['paid', 'trial'];
const DAY_MS = 24 * 60 * 60 * 1000;

const isAccessStatus = (status) => ACCESS_PAYMENT_STATUSES.includes(String(status || '').toLowerCase());

const buildSubscriptionInfo = (row, now = new Date()) => {
  if (!row) return { status: 'none', ends_at: null, days_left: 0 };
  const endDate = row.end_date ? new Date(row.end_date) : null;
  const expired = !endDate || Number.isNaN(endDate.getTime()) || endDate < now;
  const daysLeft = expired ? 0 : Math.max(0, Math.ceil((endDate - now) / DAY_MS));
  const raw = String(row.payment_status || '').toLowerCase();
  let status = raw || 'none';
  if (isAccessStatus(raw) && expired) status = 'expired';
  return { status, ends_at: row.end_date ?? null, days_left: daysLeft };
};

const loadLatestSubscriptionInfo = async (tenantId) => {
  try {
    const res = await masterPool.query(
      `SELECT payment_status, end_date
       FROM subscriptions
       WHERE tenant_id = $1
       ORDER BY end_date DESC NULLS LAST, id DESC
       LIMIT 1`,
      [tenantId]
    );
    return buildSubscriptionInfo(res?.rows?.[0] || null);
  } catch (_error) {
    return null;
  }
};

module.exports = {
  ACCESS_PAYMENT_STATUSES,
  isAccessStatus,
  buildSubscriptionInfo,
  loadLatestSubscriptionInfo,
};
