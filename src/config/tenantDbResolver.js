const masterPool = require('./masterDb');
const { getTenantPool } = require('../db/tenantPool');
const { resolveFeatures } = require('../utils/resolveFeatures');

const tenantCache = new Map();
const cacheTtlMs = 5 * 60 * 1000;

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
    `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.plan_type, t.is_active, t.addons, t.gst_mode
     FROM tenants t
     WHERE t.id = $1`,
    [tenantId]
  );
  if (tenantRes.rowCount === 0) return null;
  const tenant = tenantRes.rows[0];
  setCached(`tenant:${tenantId}`, tenant);
  return tenant;
};

const resolveTenantContextFromToken = (payload) => {
  if (!payload || payload.type !== 'tenant') return null;
  const tenantId = payload.tenant_id;
  const databaseName = payload.tenant_db;
  if (!tenantId || !databaseName) return null;

  const tenant = {
    id: tenantId,
    shop_name: payload.tenant_name || null,
    owner_name: payload.tenant_owner || null,
    email: payload.tenant_email || null,
    mobile: payload.tenant_mobile || null,
    plan_type: payload.tenant_plan || null,
    is_active: payload.tenant_active !== undefined ? payload.tenant_active : null,
    addons: payload.tenant_addons || {},
    gst_mode: payload.tenant_gst_mode || null
  };

  const tenantPool = getTenantPool(databaseName);
  const planFeatures = resolveFeatures(tenant);

  return { tenant, tenantPool, planFeatures };
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
  const planFeatures = resolveFeatures(tenant);

  return { tenant, tenantPool, planFeatures };
};

module.exports = { resolveTenantContext, resolveTenantContextFromToken };
