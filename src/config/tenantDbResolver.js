const masterPool = require('./masterDb');
const { getTenantPool } = require('../db/tenantPool');
const { getPlanFeatures } = require('../utils/planFeatures');

const tenantCache = new Map();
const cacheTtlMs = 60 * 1000;

const getCached = (key) => {
  const entry = tenantCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tenantCache.delete(key);
    return null;
  }
  return entry.value;
};

const setCached = (key, value) => {
  tenantCache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
};

const loadTenant = async (tenantId) => {
  const cached = getCached(`tenant:${tenantId}`);
  if (cached) return cached;

  const tenantRes = await masterPool.query(
    `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.plan_type, t.is_active
     FROM tenants t
     WHERE t.id = $1`,
    [tenantId]
  );
  if (tenantRes.rowCount === 0) return null;
  const tenant = tenantRes.rows[0];
  setCached(`tenant:${tenantId}`, tenant);
  return tenant;
};

const loadPlanFeaturesForTenant = async (tenantId) => {
  const key = `plan:active:${tenantId}`;
  const cached = getCached(key);
  if (cached) return cached;

  const tenantRes = await masterPool.query(
    `SELECT plan_type
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );
  const planType = tenantRes.rowCount > 0 ? tenantRes.rows[0].plan_type : null;
  const features = getPlanFeatures(planType);
  setCached(key, features);
  return features;
};

const resolveTenantContext = async (tenantId) => {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return null;

  const tenantDbRes = await masterPool.query(
    `SELECT database_name FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (tenantDbRes.rowCount === 0) return null;

  const databaseName = tenantDbRes.rows[0].database_name;
  const tenantPool = getTenantPool(databaseName);
  const planFeatures = await loadPlanFeaturesForTenant(tenantId);

  return { tenant, tenantPool, planFeatures };
};

module.exports = { resolveTenantContext };
