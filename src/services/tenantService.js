const masterPool = require('../db/masterPool');
const { provisionTenant } = require('./tenantProvisionService');

const getTenantById = async (tenantId) => {
  const result = await masterPool.query(
    `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.database_name, t.plan_type,
            t.is_active
     FROM tenants t
     WHERE t.id = $1`,
    [tenantId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

const getTenantByDomain = async (domain) => {
  const result = await masterPool.query(
    `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.database_name, t.plan_type,
            t.is_active
     FROM tenants t
     WHERE t.domain = LOWER($1)`,
    [domain]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
};

const createTenant = async (payload) => provisionTenant(payload);

module.exports = { createTenant, getTenantById, getTenantByDomain };
