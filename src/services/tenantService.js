const masterPool = require('../db/masterPool');
const { provisionTenant } = require('./tenantProvisionService');

const isMissingGstModeColumnError = (error) =>
  error?.code === '42703' && String(error?.message || '').toLowerCase().includes('gst_mode');

const queryTenant = async ({ whereClause, value }) => {
  try {
    const result = await masterPool.query(
      `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.database_name, t.plan_type,
              t.is_active, t.addons, t.gst_mode
       FROM tenants t
       WHERE ${whereClause}`,
      [value]
    );
    return result;
  } catch (error) {
    if (!isMissingGstModeColumnError(error)) throw error;
    const fallback = await masterPool.query(
      `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.database_name, t.plan_type,
              t.is_active, t.addons
       FROM tenants t
       WHERE ${whereClause}`,
      [value]
    );
    return {
      ...fallback,
      rows: (fallback.rows || []).map((row) => ({ ...row, gst_mode: null }))
    };
  }
};

const getTenantById = async (tenantId) => {
  const result = await queryTenant({ whereClause: 't.id = $1', value: tenantId });
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

const getTenantByDomain = async (domain) => {
  const result = await queryTenant({ whereClause: 't.domain = LOWER($1)', value: domain });
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

const createTenant = async (payload) => provisionTenant(payload);

module.exports = { createTenant, getTenantById, getTenantByDomain };
